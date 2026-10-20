// Cash-on-delivery order creation. All item/total/supplier data arrives
// server-computed (never from the browser); the actual write is the atomic
// create_cod_order RPC, which advisory-locks per phone then per checkout
// attempt, rate-limits, validates item/totals and dedupes reused attempts.

import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type { OrderCustomer, OrderItemInput, OrderPricing, OrderRow } from "./types.ts";
import { normalizePhone } from "./validate.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

function generateRef(): string {
    return `LM-${randomInt(100000, 1000000)}`;
}

function normField(value: string | null | undefined): string {
    return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

// Request-based fingerprint of the checkout attempt: normalized customer
// fields plus sorted productId/quantity and the literal payment method. It
// deliberately excludes prices, totals, supplier snapshots (stock/weight/
// fetched_at) and generated ids — a retry after a lost response must match
// the original attempt even if provider data changed in between.
export function codRequestFingerprint(customer: OrderCustomer, items: OrderItemInput[]): string {
    const canonical = {
        m: "cash_on_delivery",
        c: {
            n: normField(customer.name),
            // Same normalizations the client attempt id applies so equivalent
            // inputs (email case, phone formatting) bind to one attempt.
            e: normField(customer.email).toLowerCase(),
            ph: normalizePhone(normField(customer.phone)),
            d: normField(customer.cedula),
            a: normField(customer.address),
            ci: normField(customer.city),
            de: normField(customer.department ?? null),
            no: normField(customer.notes ?? null),
        },
        i: items
            .map((i) => ({ p: normField(i.productId), q: i.quantity }))
            .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)),
    };
    return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

// Recovery path for a lost create response: an attempt id that already has an
// order returns it verbatim (no re-pricing, no provider calls). A present
// attempt whose request fingerprint differs is a conflict — nothing about the
// stored order is disclosed. Lookup errors fail closed.
export async function findExistingCodOrder(
    customer: OrderCustomer,
    items: OrderItemInput[],
    attemptId: string,
    provided?: SupabaseClientLike
): Promise<{ order: OrderRow | null } | { error: string }> {
    if (!UUID_PATTERN.test(attemptId)) return { error: "invalid checkout attempt" };
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data, error } = await service
        .from("orders")
        .select("*")
        .eq("checkout_attempt_id", attemptId)
        .maybeSingle();
    if (error) return { error: "No se pudo verificar el intento de pedido." };
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { order: null };
    if (order.payment_method !== "cash_on_delivery") {
        return { error: "Este checkout cambió desde el intento anterior; vuelve a cargar la página." };
    }
    const fingerprint = codRequestFingerprint(customer, items);
    if (order.cart_fingerprint !== fingerprint) {
        return { error: "Este checkout cambió desde el intento anterior; vuelve a cargar la página." };
    }
    return { order };
}

export async function createCodOrder(
    customer: OrderCustomer,
    pricing: OrderPricing,
    consentAt: string,
    checkoutAttemptId: string,
    provided?: SupabaseClientLike
): Promise<{ ok: true; order: OrderRow; reused: boolean } | { error: string }> {
    if (!UUID_PATTERN.test(checkoutAttemptId)) return { error: "invalid checkout attempt" };
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const fingerprint = codRequestFingerprint(
        customer,
        pricing.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    const pItems = pricing.items.map((i) => ({
        product_id: i.productId,
        name: i.name,
        unit_price_cop: i.unitPriceCop,
        quantity: i.quantity,
        unit_shipping_cop: i.unitShippingCop,
        unit_supplier_cost_cop: i.unitSupplierCostCop,
        source: i.source,
        supplier_variant: i.supplierVariant,
    }));

    // Retry only the ref-allocation collision — every other failure aborts.
    for (let attempt = 0; attempt < 3; attempt++) {
        const pOrder = {
            id: randomUUID(),
            ref: generateRef(),
            lookup_token: randomBytes(32).toString("hex"),
            cart_fingerprint: fingerprint,
            checkout_attempt_id: checkoutAttemptId,
            customer_name: customer.name,
            customer_email: customer.email,
            customer_phone: customer.phone,
            customer_cedula: customer.cedula,
            address: customer.address,
            city: customer.city,
            department: customer.department,
            notes: customer.notes,
            subtotal_cop: pricing.subtotalCop,
            shipping_cop: pricing.shippingCop,
            total_cop: pricing.totalCop,
            consent_at: consentAt,
        };
        try {
            const { data, error } = await service.rpc("create_cod_order", {
                p_order: pOrder,
                p_items: pItems,
            });
            if (error) {
                const message = String(error.message ?? "");
                if (message.includes("checkout attempt changed")) {
                    return { error: "Este checkout cambió desde el intento anterior; vuelve a cargar la página." };
                }
                if (message.includes("too many requests")) {
                    return {
                        error: "Demasiados pedidos contraentrega recientes; intenta más tarde o usa pago en línea.",
                    };
                }
                // Only the generated ref can collide; retry with a fresh one.
                if (message.includes("orders_ref_key")) continue;
                // Never leak SQL details or PII to the browser.
                return { error: "No se pudo registrar el pedido contraentrega." };
            }
            const result = data as { order?: OrderRow; reused?: boolean } | null;
            if (!result?.order || typeof result.order.id !== "string") {
                return { error: "No se pudo registrar el pedido contraentrega." };
            }
            return { ok: true, order: result.order, reused: result.reused === true };
        } catch {
            // Transport failures are transient — the same attempt id can be
            // retried safely because the RPC is idempotent.
            return { error: "No se pudo registrar el pedido contraentrega." };
        }
    }
    return { error: "No se pudo registrar el pedido contraentrega." };
}
