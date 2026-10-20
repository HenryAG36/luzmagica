import { computePriceSuggestion, usdToCop } from "./pricing.ts";
import type { ImportDraftInput } from "./repository.ts";

export type ImportSource = "aliexpress_ds" | "cjdropshipping";

export interface SupplierVariant {
    id: string;
    label: string;
    price: number | null;
    currency: string | null;
    stock: number | null;
    image: string | null;
    attributes: Record<string, string | number | null>;
}

export interface SupplierProduct {
    source: ImportSource;
    productId: string;
    title: string;
    description: string;
    category: string | null;
    images: string[];
    sourceUrl: string | null;
    variants: SupplierVariant[];
    details: Record<string, string | number | null>;
    fetchedAt: string;
}

export interface SupplierFreight {
    id: string;
    label: string;
    feeUsd: number | null;
    delivery: string | null;
}

export interface ExchangeRate {
    rate: number;
    date: string;
    fetchedAt: string;
    source: "ExchangeRate-API";
}

export interface SupplierPreview {
    product: SupplierProduct;
    selectedVariantId: string | null;
    freight: SupplierFreight[];
    freightDestination: string;
    freightCheckedAt: string | null;
    fx: ExchangeRate | null;
    warnings: string[];
}

export interface ImportPricing {
    marginPercent: number;
    freightId: string | null;
    priceCop?: number;
}

export function normalizeExchangeRate(raw: unknown, nowMs = Date.now()): ExchangeRate | null {
    if (!raw || typeof raw !== "object") return null;
    const body = raw as Record<string, unknown>;
    if (body.result !== "success" || body.base_code !== "USD") return null;
    const rates = body.rates as Record<string, unknown> | undefined;
    const rate = rates?.COP;
    const updated = body.time_last_update_unix;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 ||
        typeof updated !== "number" || !Number.isFinite(updated)) return null;
    const age = nowMs - updated * 1000;
    if (age < -300_000 || age > 72 * 60 * 60 * 1000) return null;
    return {
        rate,
        date: new Date(updated * 1000).toISOString().slice(0, 10),
        fetchedAt: new Date(nowMs).toISOString(),
        source: "ExchangeRate-API",
    };
}

// CJ stock is country-specific. Do not add factory and CJ subtotals to their total.
export function cjChinaStock(rows: unknown, field: "totalInventory" | "totalInventoryNum"): number | null {
    if (!Array.isArray(rows)) return null;
    const china = rows.filter((row) => row && typeof row === "object" && row.countryCode === "CN");
    if (china.length === 0) return null;
    let total = 0;
    for (const row of china) {
        const raw = row[field];
        if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") return null;
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 0) return null;
        total += n;
    }
    return Number.isSafeInteger(total) && total <= 2147483647 ? total : null;
}

export function supplierPricing(preview: SupplierPreview, pricing: ImportPricing) {
    const variant = preview.product.variants.find((v) => v.id === preview.selectedVariantId);
    const freight = preview.freight.find((f) => f.id === pricing.freightId);
    const cost = variant?.currency === "USD"
        ? usdToCop(variant.price, preview.fx?.rate)
        : variant?.currency === "COP" && variant.price !== null
          && Number.isSafeInteger(variant.price) && variant.price >= 0 && variant.price <= 2147483647
            ? variant.price : null;
    const shipping = usdToCop(freight?.feeUsd, preview.fx?.rate);
    const suggestion = cost !== null && shipping !== null
        ? computePriceSuggestion({
            supplierCostCop: cost,
            shippingCop: shipping,
            targetMarginPercent: pricing.marginPercent,
            taxesFeesCop: null,
            paymentFeePercent: null,
        }) : null;
    return { variant, freight, cost, shipping, suggestion };
}

export function buildSupplierImport(
    preview: SupplierPreview,
    pricing: ImportPricing,
    createdBy: string
): ImportDraftInput | { error: string } {
    if (!Number.isInteger(pricing.marginPercent) || pricing.marginPercent < 15 || pricing.marginPercent > 50) {
        return { error: "El margen debe estar entre 15% y 50%." };
    }
    const { variant, freight, cost, shipping, suggestion } = supplierPricing(preview, pricing);
    if (!variant) return { error: "Selecciona una variante del proveedor." };
    if (pricing.freightId !== null && !freight) {
        return { error: "La opción de envío cambió. Consulta el producto nuevamente." };
    }
    if (pricing.priceCop !== undefined &&
        (!Number.isSafeInteger(pricing.priceCop) || pricing.priceCop <= 0 || pricing.priceCop > 2147483647)) {
        return { error: "Precio de venta inválido." };
    }
    const stock = Number.isInteger(variant.stock) && variant.stock !== null && variant.stock >= 0
        && variant.stock <= 2147483647 ? variant.stock : 0;
    const freightSnapshot = freight ? {
        option_code: freight.id,
        company: freight.label,
        fee_usd: freight.feeUsd,
        destination: preview.freightDestination,
        checked_at: preview.freightCheckedAt,
        delivery: freight.delivery,
        quantity: 1,
    } : null;
    const snapshot = {
        ...variant.attributes,
        product_id: preview.product.productId,
        ...(preview.product.source === "aliexpress_ds" ? { sku_id: variant.id } : { vid: variant.id }),
        variant_label: variant.label,
        provider_stock: variant.stock,
        provider_price: variant.price,
        currency_code: variant.currency,
        fetched_at: preview.product.fetchedAt,
        product_details: preview.product.details,
        freight: freightSnapshot,
        target_margin_percent: pricing.marginPercent,
        price_provisional: true,
    };
    return {
        source: preview.product.source,
        providerItemId: `${preview.product.productId}-${variant.id}`,
        sourceUrl: preview.product.sourceUrl,
        title: preview.product.title,
        images: [...new Set([variant.image, ...preview.product.images].filter((v): v is string => !!v))].slice(0, 10),
        listingPrice: variant.price,
        listingCurrency: variant.currency,
        category: preview.product.category,
        supplierVariant: snapshot,
        fields: {
            description: preview.product.description,
            stock,
            supplier_cost_cop: cost,
            supplier_shipping_cop: shipping,
            customer_shipping_cop: shipping,
            shipping_estimate_city: shipping !== null ? preview.freightDestination : null,
            shipping_checked_at: shipping !== null ? preview.freightCheckedAt : null,
            fx_rate: preview.fx?.rate ?? null,
            fx_rate_date: preview.fx?.date ?? null,
            price_cop: pricing.priceCop ?? suggestion?.customerProduct ?? 0,
        },
        createdBy,
    };
}
