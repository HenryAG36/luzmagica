import type { SupabaseClientLike } from "../supabase/types.ts";
import type { CatalogRow, PublicProductRow } from "../catalog/validate.ts";
import { INTERNATIONAL_SHIPPING_SOURCES, toPublicProduct } from "../catalog/validate.ts";
import { computeCartTotals } from "../cart/totals.ts";
import { resolveCoupon } from "../cart/coupons.ts";
import type { CartItem } from "../types.ts";
import type { OrderItemInput, OrderPricing, PricedItem } from "./types.ts";

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

// Server-side recompute: client-sent prices are never trusted. Every amount
// comes from catalog_products; unpublished/archived rows and international
// items without a confirmed customer shipping quote are rejected.
export async function priceOrder(
    items: OrderItemInput[],
    couponCodeRaw: string | null,
    provided?: SupabaseClientLike
): Promise<{ ok: true; pricing: OrderPricing } | { ok: false; error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { ok: false, error: "service unavailable" };

    const ids = items.map((i) => i.productId);
    const { data, error } = await service
        .from("catalog_products")
        .select("*")
        .in("id", ids);
    if (error) return { ok: false, error: "catalog lookup failed" };
    const rows = (data as CatalogRow[] | null) ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const item of items) {
        const row = byId.get(item.productId);
        if (!row || row.status !== "published") {
            return { ok: false, error: "Un producto ya no está disponible." };
        }
        if (!Number.isInteger(row.stock) || row.stock <= 0) {
            return { ok: false, error: `"${row.name}" está agotado.` };
        }
        if (item.quantity > row.stock) {
            return { ok: false, error: `No hay suficiente stock de "${row.name}".` };
        }
        if (!Number.isInteger(row.price_cop) || row.price_cop <= 0) {
            return { ok: false, error: "Precio de catálogo inválido." };
        }
        if (INTERNATIONAL_SHIPPING_SOURCES.has(row.source)) {
            const shippingOk =
                Number.isInteger(row.customer_shipping_cop) &&
                (row.customer_shipping_cop as number) >= 0 &&
                typeof row.shipping_estimate_city === "string" &&
                row.shipping_estimate_city.trim() !== "" &&
                typeof row.shipping_checked_at === "string" &&
                !Number.isNaN(Date.parse(row.shipping_checked_at));
            if (!shippingOk) {
                return { ok: false, error: `"${row.name}" no tiene cotización de envío confirmada.` };
            }
        }
    }

    const coupon = resolveCoupon(couponCodeRaw);
    if (couponCodeRaw && !coupon) {
        return { ok: false, error: "Cupón inválido o vencido." };
    }

    const cartItems: CartItem[] = items.map((item) => {
        const row = byId.get(item.productId)!;
        const publicRow = {
            ...row,
            shipping_quote_required: INTERNATIONAL_SHIPPING_SOURCES.has(row.source),
        } as PublicProductRow;
        return { product: toPublicProduct(publicRow), quantity: item.quantity };
    });

    const totals = computeCartTotals(cartItems, coupon?.code ?? null, coupon?.percent ?? 0, 0);
    if (totals.dsPending || totals.shippingCop === null || totals.total === null) {
        return { ok: false, error: "No se pudo confirmar el costo de envío del pedido." };
    }

    const pricedItems: PricedItem[] = items.map((item) => {
        const row = byId.get(item.productId)!;
        const isInternational = INTERNATIONAL_SHIPPING_SOURCES.has(row.source);
        return {
            productId: row.id,
            name: row.name,
            unitPriceCop: row.price_cop,
            quantity: item.quantity,
            unitShippingCop: isInternational ? (row.customer_shipping_cop as number) : 0,
            unitSupplierCostCop: Number.isInteger(row.supplier_cost_cop) ? row.supplier_cost_cop : null,
            source: row.source,
            supplierVariant: row.supplier_variant,
        };
    });

    return {
        ok: true,
        pricing: {
            items: pricedItems,
            subtotalCop: totals.subtotal,
            discountCop: totals.discountCop,
            shippingCop: totals.shippingCop,
            totalCop: totals.total,
            couponCode: coupon?.code ?? null,
        },
    };
}
