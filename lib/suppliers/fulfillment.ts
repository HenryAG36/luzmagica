import type { SupabaseClientLike } from "../supabase/types.ts";
import type { FetchLike } from "../trends/http.ts";
import type { OrderItemRow, OrderRow } from "../orders/types.ts";
import { getAliExpressDsEnv } from "../env.ts";
import * as ds from "./aliexpressDs.ts";
import { DS_PROVIDER, getDsAccessToken } from "./dsService.ts";
import { CJ_PROVIDER, createCjOrder, fetchCjVariants, getCjAccessToken } from "./cjdropshipping.ts";

const SUPPLIER_SOURCES = new Set([DS_PROVIDER, "aliexpress_ds", CJ_PROVIDER, "cjdropshipping"]);

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

interface SupplierRefs {
    ds?: string | null;
    cj?: string | null;
}

function joinSupplierRefs(refs: SupplierRefs): string | null {
    const parts: string[] = [];
    if (refs.ds) parts.push(`aliexpress_ds:${refs.ds}`);
    if (refs.cj) parts.push(`cjdropshipping:${refs.cj}`);
    return parts.length ? parts.join(",") : null;
}

function variantField(item: OrderItemRow, key: string): string | null {
    const v = item.supplier_variant?.[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
    return null;
}

// Places the paid order's supplier-backed items with their providers.
// Idempotent: an order already submitted (or with a recorded supplier order
// id) returns the existing reference instead of re-ordering. Provider
// failures are surfaced verbatim to the operator and recorded on the order.
export async function placeSupplierOrder(
    orderId: string,
    provided?: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<{ ok: true; supplierOrderId: string | null; alreadyPlaced: boolean; notes: string[] } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data } = await service.from("orders").select("*").eq("id", orderId).maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };

    if (order.payment_status !== "paid") {
        return { error: "supplier orders can only be placed for verified paid orders" };
    }
    // Idempotency: a fully submitted order never re-places. 'failed' and
    // 'partial' can be retried — providers dedupe on out_order_id/orderNumber.
    if (
        order.supplier_order_status === "submitted" ||
        (order.supplier_order_id &&
            order.supplier_order_status !== "failed" &&
            order.supplier_order_status !== "partial")
    ) {
        return {
            ok: true,
            supplierOrderId: order.supplier_order_id,
            alreadyPlaced: true,
            notes: [],
        };
    }
    if (order.supplier_order_status === "submitting") {
        return { error: "supplier placement already in progress" };
    }

    const { data: itemRows } = await service.from("order_items").select("*").eq("order_id", orderId);
    const items = (itemRows as OrderItemRow[] | null) ?? [];
    const dsItems = items.filter((i) => i.source === "aliexpress_ds");
    const cjItems = items.filter((i) => i.source === "cjdropshipping");
    const manualItems = items.filter((i) => !SUPPLIER_SOURCES.has(i.source));
    const notes: string[] = manualItems.map((i) => `${i.name}: envío manual (sin integración de proveedor)`);

    if (dsItems.length === 0 && cjItems.length === 0) {
        return { error: "no supplier-backed items in this order" };
    }

    // Validate supplier data up front — a bad snapshot fails fast without
    // claiming the order.
    for (const item of dsItems) {
        if (!variantField(item, "product_id") || !variantField(item, "sku_id")) {
            return { error: `"${item.name}" no tiene snapshot de variante AliExpress` };
        }
    }

    // Optimistic claim: only one worker may move supplier_order_status off
    // its current value.
    const now = new Date().toISOString();
    const { data: claimed } = await service
        .from("orders")
        .update({ supplier_order_status: "submitting", supplier_order_error: null, updated_at: now })
        .eq("id", orderId)
        .eq("updated_at", order.updated_at)
        .select("id");
    if (((claimed as { id: string }[] | null) ?? []).length === 0) {
        return { error: "order changed; reload and retry" };
    }

    const refs: SupplierRefs = {};
    const errors: string[] = [];

    if (dsItems.length > 0) {
        const env = getAliExpressDsEnv();
        const token = env ? await getDsAccessToken(service, fetchImpl) : { error: "aliexpress ds not configured" };
        if ("error" in token) {
            errors.push(`AliExpress DS: ${token.error}`);
        } else if (env) {
            const phoneDigits = order.customer_phone.replace(/\D/g, "");
            const result = await ds.createDsOrder(
                token.token,
                {
                    address: {
                        fullName: order.customer_name,
                        contactPerson: order.customer_name,
                        phone: phoneDigits.slice(-10),
                        phoneCountry: "+57",
                        address: order.address,
                        city: order.city,
                        province: order.department ?? order.city,
                        zip: "",
                    },
                    items: dsItems.map((i) => ({
                        productId: variantField(i, "product_id") as string,
                        skuAttr: variantField(i, "sku_attr") ?? "",
                        count: i.quantity,
                        logisticsServiceName:
                            variantField(i, "freight_company") ??
                            (typeof i.supplier_variant?.freight === "object" && i.supplier_variant.freight !== null
                                ? ((i.supplier_variant.freight as Record<string, unknown>).company as string | undefined) ?? null
                                : null),
                        memo: `Pedido ${order.ref}`,
                    })),
                    outOrderId: order.ref,
                },
                env,
                fetchImpl
            );
            if (result.ok && result.data) {
                refs.ds = result.data.orderId ?? "submitted";
            } else {
                errors.push(`AliExpress DS: ${result.error ?? "order rejected"}`);
            }
        }
    }

    if (cjItems.length > 0) {
        const token = await getCjAccessToken(service, fetchImpl);
        if ("error" in token) {
            errors.push(`CJ Dropshipping: ${token.error}`);
        } else {
            const products: { vid: string; quantity: number }[] = [];
            for (const item of cjItems) {
                let vid = variantField(item, "vid");
                if (!vid) {
                    const variants = await fetchCjVariants(token.token, item.product_id, fetchImpl);
                    if (!variants.ok || !variants.data) {
                        errors.push(`CJ "${item.name}": ${variants.error ?? "variant lookup failed"}`);
                        continue;
                    }
                    if (variants.data.length !== 1) {
                        errors.push(`CJ "${item.name}": ${variants.data.length} variantes — requiere selección manual`);
                        continue;
                    }
                    vid = variants.data[0].vid;
                }
                products.push({ vid, quantity: item.quantity });
            }
            if (products.length === cjItems.length) {
                const result = await createCjOrder(
                    token.token,
                    {
                        orderNumber: order.ref,
                        customer: {
                            name: order.customer_name,
                            email: order.customer_email,
                            phone: order.customer_phone,
                            address: order.address,
                            city: order.city,
                            province: order.department ?? order.city,
                            zip: "",
                        },
                        products,
                    },
                    fetchImpl
                );
                if (result.ok && result.data) {
                    refs.cj = result.data.orderId ?? result.data.orderNumber ?? "submitted";
                } else {
                    errors.push(`CJ Dropshipping: ${result.error ?? "order rejected"}`);
                }
            }
        }
    }

    const supplierOrderId = joinSupplierRefs(refs);
    const failed = errors.length > 0;
    const finalStatus = failed && !supplierOrderId ? "failed" : failed ? "partial" : "submitted";
    const { data: persisted } = await service
        .from("orders")
        .update({
            supplier_order_id: supplierOrderId,
            supplier_order_status: finalStatus,
            supplier_order_error: failed ? errors.join(" | ").slice(0, 500) : null,
            supplier_order_placed_at: supplierOrderId ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("supplier_order_status", "submitting")
        .select("id");
    if (((persisted as { id: string }[] | null) ?? []).length === 0) {
        return { error: "order changed while placing supplier order; verify before retry" };
    }

    await service.from("order_events").insert({
        order_id: orderId,
        kind: "fulfillment",
        status: "supplier_processing",
        label: failed ? "Pedido a proveedor falló" : "Pedido enviado a proveedor",
        description: [
            supplierOrderId ? `Ref. proveedor: ${supplierOrderId}` : null,
            ...errors,
            ...notes,
        ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 500),
    });

    if (failed) {
        return { error: errors.join(" | ") };
    }
    return { ok: true, supplierOrderId, alreadyPlaced: false, notes };
}
