// Supplier import orchestration: product preview (detail + variant + freight +
// FX), bounded input parsing and pure request-body validation shared by the
// admin API routes. Never trusts client-supplied pricing/stock — everything is
// refetched server-side at import time.

import { randomUUID } from "crypto";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type { FetchLike } from "../trends/http.ts";
import { fetchJson } from "../trends/http.ts";
import {
    acquireProviderLease,
    releaseProviderLease,
    markConnectionError,
} from "../trends/service.ts";
import {
    isValidDsProductId,
    type DsProduct,
} from "./aliexpressDs.ts";
import { lookupDsProduct, lookupDsFreight } from "./dsService.ts";
import {
    CJ_PROVIDER,
    getCjAccessToken,
} from "./cjdropshipping.ts";
import {
    fetchCjProductDetail,
    fetchCjVariantStock,
    fetchCjFreight,
    isValidCjId,
} from "./cjCatalog.ts";
import type {
    ExchangeRate,
    ImportSource,
    SupplierFreight,
    SupplierPreview,
    SupplierProduct,
    SupplierVariant,
} from "../catalog/supplierImport.ts";
import { normalizeExchangeRate } from "../catalog/supplierImport.ts";
import { resolveUsdAmount } from "../catalog/pricing.ts";
import { isPlainObject } from "../catalog/validate.ts";

export type { ImportSource };

const MAX_INPUT_LENGTH = 2048;
const VARIANT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_PROVIDER_ITEM_ID = 128;
const CJ_IMPORT_DEADLINE_MS = 55_000; // routes are maxDuration=60s
const IMPORT_DEADLINE_MS = 45_000; // shared supplier-work budget per preview
const FX_URL = "https://open.er-api.com/v6/latest/USD";

// --- Input parsing ---------------------------------------------------------

function parseAliExpressUrl(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    const isAliExpress =
        host === "aliexpress.com" || host.endsWith(".aliexpress.com");
    if (!isAliExpress) return null;
    const match = url.pathname.match(/\/item\/(\d+)\.html/i);
    return match && isValidDsProductId(match[1]) ? match[1] : null;
}

function parseCjUrl(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    const isCj =
        host === "cjdropshipping.com" || host.endsWith(".cjdropshipping.com");
    if (!isCj) return null;
    const path = url.pathname.match(/-p-([A-Za-z0-9._-]{1,64})\.html/i);
    if (path) return path[1];
    const pid = url.searchParams.get("pid");
    return pid && isValidCjId(pid) ? pid : null;
}

// Accepts a raw provider id or a pasted product URL. Never fetches the input —
// parsing is pure string/URL work; shortened links are rejected.
export function parseSupplierProductId(
    source: ImportSource,
    input: string
): string | null {
    if (typeof input !== "string" || input.length === 0 || input.length > MAX_INPUT_LENGTH) {
        return null;
    }
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return null;

    if (/^https?:\/\//i.test(trimmed)) {
        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            return null;
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        return source === "aliexpress_ds" ? parseAliExpressUrl(url) : parseCjUrl(url);
    }

    if (source === "aliexpress_ds") {
        return isValidDsProductId(trimmed) ? trimmed : null;
    }
    return isValidCjId(trimmed) ? trimmed : null;
}

export function isValidVariantId(value: unknown): value is string {
    return typeof value === "string" && VARIANT_ID_PATTERN.test(value);
}

// --- Request body validation (pure, unit-testable) -------------------------

export function validatePreviewBody(
    body: unknown
): { source: ImportSource; productId: string; variantId?: string } | { error: string } {
    if (!isPlainObject(body)) return { error: "invalid body" };
    const source = body.source;
    if (source !== "aliexpress_ds" && source !== "cjdropshipping") {
        return { error: "invalid source" };
    }
    if (typeof body.productId !== "string") return { error: "invalid product id" };
    const productId = parseSupplierProductId(source, body.productId);
    if (!productId) return { error: "invalid product id or url" };
    let variantId: string | undefined;
    if (body.variantId !== undefined && body.variantId !== null) {
        if (!isValidVariantId(body.variantId)) return { error: "invalid variant id" };
        variantId = body.variantId;
    }
    const combined = variantId
        ? `${productId}-${variantId}`.length
        : productId.length;
    if (combined > MAX_PROVIDER_ITEM_ID) {
        return { error: "identifier too long" };
    }
    return { source, productId, variantId };
}

export function validateImportBody(
    body: unknown
):
    | {
          source: ImportSource;
          productId: string;
          variantId: string;
          freightId: string | null;
          marginPercent: number;
          priceCop?: number;
      }
    | { error: string } {
    if (!isPlainObject(body)) return { error: "invalid body" };
    const base = validatePreviewBody(body);
    if ("error" in base) return base;
    if (typeof base.variantId !== "string" || !base.variantId) {
        return { error: "variant id required" };
    }
    const freightId = body.freightId;
    if (freightId !== null && freightId !== undefined &&
        (typeof freightId !== "string" || freightId.length > 120)) {
        return { error: "invalid freight id" };
    }
    const margin = body.marginPercent;
    if (typeof margin !== "number" || !Number.isInteger(margin) || margin < 15 || margin > 50) {
        return { error: "invalid margin" };
    }
    let priceCop: number | undefined;
    const priceRaw = body.priceCop;
    if (priceRaw !== undefined && priceRaw !== null) {
        if (typeof priceRaw !== "number" || !Number.isSafeInteger(priceRaw) ||
            priceRaw <= 0 || priceRaw > 2147483647) {
            return { error: "invalid price" };
        }
        priceCop = priceRaw;
    }
    return {
        source: base.source,
        productId: base.productId,
        variantId: base.variantId,
        freightId: typeof freightId === "string" ? freightId : null,
        marginPercent: margin,
        priceCop,
    };
}

// --- Exchange rate ---------------------------------------------------------

export async function fetchImportExchangeRate(
    fetchImpl?: FetchLike
): Promise<ExchangeRate | null> {
    if (fetchImpl) {
        const res = await fetchJson<unknown>(FX_URL, {}, { timeoutMs: 8000, fetchImpl });
        if (!res.ok) return null;
        return normalizeExchangeRate(res.data);
    }
    try {
        const res = await fetch(FX_URL, {
            signal: AbortSignal.timeout(8000),
            // Next.js runtime fetch extension — 6h cache
            ...({ next: { revalidate: 21_600 } } as RequestInit),
        });
        if (!res.ok) return null;
        return normalizeExchangeRate(await res.json());
    } catch {
        return null;
    }
}

// --- DS mapping ------------------------------------------------------------

function dsStock(value: number | null): number | null {
    return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
        ? value
        : null;
}

function dsProductToSupplierProduct(
    product: DsProduct,
    requestedId: string
): SupplierProduct | null {
    if (product.productId !== requestedId) return null;
    const variants: SupplierVariant[] = product.skus
        .filter(
            (sku) =>
                VARIANT_ID_PATTERN.test(sku.skuId) &&
                `${product.productId}-${sku.skuId}`.length <= MAX_PROVIDER_ITEM_ID
        )
        .slice(0, 100)
        .map((sku) => {
            const rawPrice = sku.offerSalePrice ?? sku.skuPrice;
            return {
                id: sku.skuId,
                label: sku.skuAttr || sku.skuId,
                price:
                    typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice >= 0
                        ? rawPrice
                        : null,
                currency: sku.currency ?? product.currency,
                stock: dsStock(sku.availableStock),
                image: null,
                attributes: { sku_attr: sku.skuAttr },
            };
        });
    return {
        source: "aliexpress_ds",
        productId: product.productId,
        title: product.title,
        description: product.descriptionText,
        category: null, // categoryId is a numeric id, not a display name
        images: product.images,
        sourceUrl: product.sourceUrl,
        variants,
        details: {
            category_id: product.categoryId,
            delivery_time_days: product.deliveryTimeDays,
            provider_reported_sales: product.providerReportedSales,
        },
        fetchedAt: new Date().toISOString(),
    };
}

function dsFreightOptions(
    quote: { options: { code: string | null; company: string | null; feeUsd: number | null; feeCurrency: string | null; minDays: number | null; maxDays: number | null }[] },
    productCurrency: string | null
): SupplierFreight[] {
    const seen = new Set<string>();
    const out: SupplierFreight[] = [];
    for (const option of quote.options) {
        const id = option.code ?? option.company;
        if (!id || seen.has(id)) continue; // no stable identity → skip
        seen.add(id);
        const delivery =
            option.minDays !== null && option.maxDays !== null
                ? `${option.minDays}–${option.maxDays} días`
                : null;
        out.push({
            id,
            label: option.company ?? option.code ?? id,
            feeUsd: resolveUsdAmount(option.feeUsd, option.feeCurrency, productCurrency),
            delivery,
        });
        if (out.length >= 20) break;
    }
    return out;
}

// --- Shared preview assembly ------------------------------------------------

function selectVariant(
    product: SupplierProduct,
    variantId: string | undefined,
    warnings: string[]
): string | null {
    if (product.variants.length === 0) {
        warnings.push("El proveedor no devolvió variantes; no se puede importar sin una variante.");
        return null;
    }
    if (variantId) {
        return product.variants.some((v) => v.id === variantId) ? variantId : null;
    }
    if (product.variants.length === 1) return product.variants[0].id;
    return null; // multiple variants require an explicit choice
}

function productWarnings(product: SupplierProduct, warnings: string[]) {
    if (!product.description) warnings.push("El proveedor no devolvió descripción; complétala antes de publicar.");
    if (!product.category) warnings.push("El proveedor no devolvió una categoría legible; asígnala en el borrador.");
    if (product.images.length === 0) warnings.push("El proveedor no devolvió imágenes; agrega imágenes con derecho de uso antes de publicar.");
    if (product.variants.every((v) => v.stock === null)) warnings.push("Stock no reportado por el proveedor; se importará como 0 hasta verificar.");
    if (product.variants.every((v) => v.price === null)) warnings.push("El proveedor no devolvió precios válidos; el costo quedará pendiente.");
}

// Warnings specific to the resolved variant — every() above can miss a bad
// selection when other variants are valid.
function selectedWarnings(variant: SupplierVariant | undefined, warnings: string[]) {
    if (!variant) return;
    if (variant.stock === null) {
        warnings.push("El stock de la variante seleccionada no fue verificado; el borrador se importará con stock 0.");
    } else if (variant.stock === 0) {
        warnings.push("La variante seleccionada no tiene stock disponible actualmente.");
    }
    if (variant.price === null) warnings.push("El proveedor no devolvió precio para la variante seleccionada; el costo quedará pendiente.");
    if (!variant.currency) warnings.push("El proveedor no devolvió la moneda de la variante; la conversión quedará pendiente.");
}

// --- Preview orchestration ---------------------------------------------------

async function lookupAliExpressPreview(
    service: SupabaseClientLike,
    productId: string,
    variantId: string | undefined,
    fetchImpl: FetchLike | undefined,
    requestDeadlineMs?: number
): Promise<{ preview: SupplierPreview } | { error: string }> {
    const warnings: string[] = [];
    const productResult = await lookupDsProduct(service, productId, fetchImpl, requestDeadlineMs);
    if ("error" in productResult) return { error: productResult.error };
    const product = dsProductToSupplierProduct(productResult.product, productId);
    if (!product) return { error: "el producto del proveedor no coincide con el id solicitado" };
    if (product.variants.length < productResult.product.skus.length) {
        warnings.push("Algunas variantes del proveedor tenían identificadores inválidos y fueron descartadas.");
    }

    productWarnings(product, warnings);
    const selectedVariantId = selectVariant(product, variantId, warnings);
    if (variantId && selectedVariantId === null) {
        return { error: "la variante seleccionada no pertenece a este producto" };
    }
    if (selectedVariantId === null && product.variants.length > 1) {
        warnings.push("El producto tiene varias variantes; elige una antes de importar.");
    }
    const selected = product.variants.find((v) => v.id === selectedVariantId);
    selectedWarnings(selected, warnings);

    let freight: SupplierFreight[] = [];
    let freightDestination = "Colombia";
    let freightCheckedAt: string | null = null;
    if (selectedVariantId) {
        const quoteResult = await lookupDsFreight(
            service, productId, selectedVariantId, fetchImpl, requestDeadlineMs
        );
        if ("error" in quoteResult) {
            warnings.push(`No se pudo cotizar el envío (${quoteResult.error}); quedará pendiente en el borrador.`);
        } else {
            freight = dsFreightOptions(quoteResult.quote, selected?.currency ?? null);
            freightDestination = quoteResult.quote.destination;
            freightCheckedAt = quoteResult.quote.checkedAt;
            if (freight.length === 0) {
                warnings.push("El proveedor no devolvió opciones de envío válidas; el envío quedará pendiente.");
            }
        }
    }

    const fx = await fetchImportExchangeRate(fetchImpl);
    if (!fx) {
        warnings.push("No se pudo obtener la tasa USD→COP; costo y envío quedarán sin convertir.");
    }

    return {
        preview: {
            product,
            selectedVariantId,
            freight,
            freightDestination,
            freightCheckedAt,
            fx,
            warnings,
        },
    };
}

async function lookupCjPreview(
    service: SupabaseClientLike,
    productId: string,
    variantId: string | undefined,
    fetchImpl: FetchLike | undefined,
    requestDeadlineMs?: number
): Promise<{ preview: SupplierPreview } | { error: string }> {
    const warnings: string[] = [];
    const owner = randomUUID();
    const acquired = await acquireProviderLease(service, CJ_PROVIDER, owner);
    if (!acquired) return { error: "another cjdropshipping request is in progress" };

    let result: { preview: SupplierPreview } | { error: string };
    try {
        const deadlineMs = Math.min(
            requestDeadlineMs ?? Infinity,
            Date.now() + CJ_IMPORT_DEADLINE_MS
        );
        const tokenResult = await getCjAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) {
            result = { error: tokenResult.error };
        } else {
            const detailResult = await fetchCjProductDetail(tokenResult.token, productId, fetchImpl, deadlineMs);
            if (!detailResult.ok || !detailResult.data) {
                await markConnectionError(service, CJ_PROVIDER, detailResult.error || "product lookup failed");
                result = { error: detailResult.error || "product lookup failed" };
            } else {
                const product = detailResult.data;
                productWarnings(product, warnings);
                const selectedVariantId = selectVariant(product, variantId, warnings);
                if (variantId && selectedVariantId === null) {
                    result = { error: "la variante seleccionada no pertenece a este producto" };
                } else {
                    if (selectedVariantId === null && product.variants.length > 1) {
                        warnings.push("El producto tiene varias variantes; elige una antes de importar.");
                    }
                    const selected = product.variants.find((v) => v.id === selectedVariantId);
                    let freight: SupplierFreight[] = [];
                    let freightCheckedAt: string | null = null;
                    if (selectedVariantId) {
                        const stockResult = await fetchCjVariantStock(
                            tokenResult.token, selectedVariantId, fetchImpl, deadlineMs
                        );
                        const variant = selected;
                        if (!stockResult.ok) {
                            if (variant) variant.stock = null;
                            warnings.push(`No se pudo verificar el inventario actual (${stockResult.error ?? "error"}); se importará sin stock confirmado.`);
                        } else {
                            // data === null means no CN stock row — warn instead
                            // of pretending inventory was verified.
                            const verifiedStock = stockResult.data ?? null;
                            if (variant) variant.stock = verifiedStock;
                            if (verifiedStock === null) {
                                warnings.push("El proveedor no reportó inventario CN para esta variante.");
                            }
                        }

                        const freightResult = await fetchCjFreight(
                            tokenResult.token, selectedVariantId, fetchImpl, deadlineMs
                        );
                        if (!freightResult.ok || !freightResult.data) {
                            warnings.push(`No se pudo cotizar el envío (${freightResult.error ?? "error"}); quedará pendiente en el borrador.`);
                        } else {
                            freight = freightResult.data;
                            if (freight.length === 0) {
                                warnings.push("El proveedor no devolvió opciones de envío válidas; el envío quedará pendiente.");
                            } else {
                                freightCheckedAt = new Date().toISOString();
                            }
                        }
                    }
                    selectedWarnings(selected, warnings);
                    result = {
                        preview: {
                            product,
                            selectedVariantId,
                            freight,
                            freightDestination: "Colombia (CN → CO)",
                            freightCheckedAt,
                            fx: null,
                            warnings,
                        },
                    };
                }
            }
        }
    } finally {
        await releaseProviderLease(service, CJ_PROVIDER, owner);
    }

    if ("error" in result) return result;
    // FX is an external public endpoint, not a provider call — the lease is
    // released before fetching it.
    const fx = await fetchImportExchangeRate(fetchImpl);
    result.preview.fx = fx;
    if (!fx) {
        warnings.push("No se pudo obtener la tasa USD→COP; costo y envío quedarán sin convertir.");
    }
    return result;
}

export async function lookupSupplierPreview(
    service: SupabaseClientLike,
    source: ImportSource,
    productId: string,
    variantId?: string,
    fetchImpl?: FetchLike
): Promise<{ preview: SupplierPreview } | { error: string }> {
    const parsed = parseSupplierProductId(source, productId);
    if (!parsed) return { error: "invalid product id or url" };
    if (variantId !== undefined && !isValidVariantId(variantId)) {
        return { error: "invalid variant id" };
    }
    const requestDeadlineMs = Date.now() + IMPORT_DEADLINE_MS;
    if (source === "aliexpress_ds") {
        return lookupAliExpressPreview(service, parsed, variantId, fetchImpl, requestDeadlineMs);
    }
    return lookupCjPreview(service, parsed, variantId, fetchImpl, requestDeadlineMs);
}
