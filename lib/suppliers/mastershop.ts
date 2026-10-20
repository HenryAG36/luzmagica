// Mastershop Colombia integration. Contract verified against the official
// Postman collection: base https://prod.api.mastershop.com, auth header
// `ms-api-key`, `POST /api/products/market` for marketplace search (page = row
// offset, limit 20, plain-array response), `GET /api/products/market/{id}` for
// the authoritative detail object, and
// `GET /api/products/{id}?includeAllVariations=true` for the
// account-membership check (404 = product not in the account's list).
//
// Capability boundary: catalog search/detail and (behind a feature flag) COD
// order create/lookup are wired — see mastershopOrders.ts. No external freight
// endpoint is documented, so shipping quotes remain operator-confirmed. The
// marketplace summary row is never used as fulfillment truth; the detail
// endpoint is always refetched at import time.

import type { FetchLike } from "../trends/http.ts";
import { isHttpUrl, isPlainObject } from "../catalog/validate.ts";
import { stripHtmlToText } from "./aliexpressDs.ts";
import { getMastershopApiKey } from "../env.ts";
import type {
    SupplierPreview,
    SupplierProduct,
    SupplierVariant,
} from "../catalog/supplierImport.ts";

const MASTERSHOP_BASE = "https://prod.api.mastershop.com";
const MASTERSHOP_APP = "https://app.mastershop.com";
const TIMEOUT_MS = 12_000;
const PAGE_SIZE = 20;
const MAX_VARIANTS = 200;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_OFFSET = 100000;

const MASTERSHOP_ID = /^[1-9][0-9]{0,15}$/;
// Per provider docs the search term accepts Unicode letters, digits and spaces.
const SEARCH_QUERY = /^[\p{L}\p{N} ]*$/u;

export interface MastershopCatalogPage {
    products: SupplierProduct[];
    offset: number;
    hasMore: boolean;
    warnings: string[];
}

export type MastershopResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export function isValidMastershopProductId(value: unknown): value is string {
    if (typeof value !== "string" || !MASTERSHOP_ID.test(value)) return false;
    return Number.isSafeInteger(Number(value));
}

// Prices/stock arrive as numbers or decimal strings. Only primitives matching
// the numeric grammar are accepted — arrays, objects, booleans and whitespace
// coerce unpredictably through Number(), so they are "unknown", never 0.
function boundedAmount(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
}

function boundedText(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > max) return null;
    return trimmed;
}

function mastershopProductId(raw: unknown): string | null {
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return String(raw);
    return isValidMastershopProductId(raw) ? raw : null;
}

function mastershopImageUrl(value: unknown): string | null {
    const text = boundedText(value, 2000);
    if (!text) return null;
    return isHttpUrl(text) ? text : null;
}

export function normalizeMastershopProduct(
    raw: unknown,
    now = new Date().toISOString()
): SupplierProduct | null {
    if (!isPlainObject(raw)) return null;
    const id = mastershopProductId(raw.idProduct);
    if (!id) return null;
    const name = boundedText(raw.nameProduct, 200);
    if (!name) return null;

    // Only literal COP is accepted — any other/missing currency means the
    // amounts are not COP, so prices and the suggested retail must be null
    // rather than displayed as pesos.
    const isCop = raw.baseCurrencyPrice === "COP";
    const currency = isCop ? "COP" : null;
    const suggestedPrice = isCop ? boundedAmount(raw.suggestedPrice) : null;
    const image = mastershopImageUrl(raw.urlImageProduct);

    // variants must be a documented array — malformed entries, missing or
    // duplicate ids invalidate the whole product rather than silently hiding
    // purchase options.
    const rawVariants = raw.variants;
    if (!Array.isArray(rawVariants) || rawVariants.length > MAX_VARIANTS) return null;

    const variants: SupplierVariant[] = [];
    if (rawVariants.length === 0) {
        variants.push({
            id: "simple",
            label: "Único",
            // Top-level price/stock are used only for single-variant products.
            price: isCop ? boundedAmount(raw.providerPrice) : null,
            currency,
            stock: boundedAmount(raw.stock),
            image: null,
            attributes: {
                sku: null,
                suggested_price: suggestedPrice,
            },
        });
    } else {
        const seenIds = new Set<string>();
        for (const entry of rawVariants) {
            if (!isPlainObject(entry)) return null;
            const vid = mastershopProductId(entry.idVariant);
            if (!vid || seenIds.has(vid)) return null;
            seenIds.add(vid);
            const vname = boundedText(entry.name, 80);
            const sku = boundedText(entry.sku, 80);
            variants.push({
                id: vid,
                label: vname ?? `Variante ${vid}`,
                // Only the variant's own price/stock — never the parent's.
                price: isCop ? boundedAmount(entry.price) : null,
                currency,
                stock: boundedAmount(entry.stock),
                image: null,
                attributes: {
                    sku,
                    suggested_price: suggestedPrice,
                },
            });
        }
    }

    const details: Record<string, string | number | null> = {
        suggested_price: suggestedPrice,
    };
    // Detail object uses `providerName`; marketplace summaries carry
    // `nameProvider` and are mapped before normalization.
    const provider = boundedText(raw.providerName, 80);
    if (provider) details.provider_name = provider;

    return {
        source: "mastershop",
        productId: id,
        title: name,
        description: stripHtmlToText(raw.description).slice(0, MAX_TEXT),
        category: boundedText(raw.categoryName, 80),
        images: image ? [image] : [],
        sourceUrl: `${MASTERSHOP_APP}/products/market/${id}`,
        variants,
        details,
        fetchedAt: now,
    };
}

function keyMissingError(): { error: string } {
    return {
        error: "Mastershop no está configurado: define MASTERSHOP_API_KEY en las variables de entorno del servidor.",
    };
}

function mastershopHttpError(status: number): string {
    if (status === 401 || status === 403) {
        return "Mastershop rechazó el acceso: verifica que la API key esté autorizada para tu cuenta.";
    }
    if (status === 404) {
        return "Mastershop no encontró el recurso solicitado.";
    }
    if (status === 429) {
        return "Mastershop está limitando las solicitudes; espera unos minutos e intenta de nuevo.";
    }
    return `Mastershop respondió con un error (HTTP ${status}).`;
}

export async function mastershopRequest(
    path: string,
    init: { method: "GET" | "POST" | "PUT"; body?: unknown },
    fetchImpl?: FetchLike
): Promise<MastershopResult<unknown>> {
    if (typeof path !== "string" || !path.startsWith("/api/") ||
        path.includes("..") || /[\s"'<>\\]/.test(path)) {
        return { ok: false, error: "invalid path" };
    }
    const key = getMastershopApiKey();
    if (!key) return { ok: false, error: keyMissingError().error };
    const doFetch = fetchImpl ?? fetch;
    let res: Response;
    try {
        res = await doFetch(`${MASTERSHOP_BASE}${path}`, {
            method: init.method,
            headers: {
                "content-type": "application/json",
                "ms-api-key": key,
            },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        return { ok: false, error: "No se pudo contactar a Mastershop; revisa la conexión e intenta de nuevo." };
    }
    if (!res.ok) {
        return { ok: false, error: mastershopHttpError(res.status), status: res.status };
    }
    // Streamed read with a hard byte cap — string length would undercount
    // multi-byte payloads and read them fully before checking.
    let text: string;
    try {
        if (!res.body) return { ok: false, error: "Mastershop devolvió una respuesta inválida." };
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel().catch(() => undefined);
                return {
                    ok: false,
                    error: "La respuesta de Mastershop excede el tamaño máximo permitido.",
                };
            }
            chunks.push(value);
        }
        const joined = new Uint8Array(size);
        let pos = 0;
        for (const c of chunks) {
            joined.set(c, pos);
            pos += c.byteLength;
        }
        text = new TextDecoder().decode(joined);
    } catch {
        return { ok: false, error: "Mastershop devolvió una respuesta inválida." };
    }
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { ok: false, error: "Mastershop devolvió una respuesta inválida." };
    }
    return { ok: true, data };
}

// Maps a marketplace summary row onto the detail field names. The summary is
// display-only discovery data — variants are intentionally emptied so the
// import path always refetches authoritative detail.
function mapSummaryToDetail(raw: unknown): Record<string, unknown> | null {
    if (!isPlainObject(raw)) return null;
    return {
        ...raw,
        nameProduct: raw.productName ?? raw.nameProduct,
        providerPrice: raw.basePrice ?? raw.providerPrice,
        providerName: raw.providerName ?? raw.nameProvider,
        categoryName:
            typeof raw.category === "string" ? raw.category : raw.categoryName,
        variants: [],
    };
}

export async function searchMastershopProducts(
    query: string,
    offset: number,
    fetchImpl?: FetchLike
): Promise<{ page: MastershopCatalogPage } | { error: string }> {
    if (typeof query !== "string" || query.length > 120 || !SEARCH_QUERY.test(query)) {
        return { error: "invalid query" };
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
        return { error: "invalid offset" };
    }
    const trimmed = query.trim();
    const result = await mastershopRequest(
        `/api/products/market?page=${offset}&limit=${PAGE_SIZE}`,
        {
            method: "POST",
            body: trimmed !== "" ? { valueToSearch: trimmed } : {},
        },
        fetchImpl
    );
    if (!result.ok) return { error: result.error };
    // Documented shape is a plain array of summary rows.
    if (!Array.isArray(result.data)) {
        return { error: "Mastershop devolvió una respuesta inesperada." };
    }
    const rawItems = result.data as unknown[];
    const warnings: string[] = [];
    const products: SupplierProduct[] = [];
    let skipped = 0;
    for (const item of rawItems) {
        const mapped = mapSummaryToDetail(item);
        const product = mapped && normalizeMastershopProduct(mapped);
        if (product) {
            product.details.discovery_only = 1; // summary row — never import truth
            products.push(product);
        } else {
            skipped += 1;
        }
    }
    if (skipped > 0) {
        warnings.push(`${skipped} producto(s) de Mastershop llegaron con datos inválidos y fueron omitidos.`);
    }
    return {
        page: {
            products,
            offset,
            hasMore: rawItems.length === PAGE_SIZE,
            warnings,
        },
    };
}

export async function getMastershopProduct(
    productId: string,
    fetchImpl?: FetchLike
): Promise<{ product: SupplierProduct } | { error: string }> {
    if (!isValidMastershopProductId(productId)) {
        return { error: "invalid product id" };
    }
    const result = await mastershopRequest(
        `/api/products/market/${encodeURIComponent(productId)}`,
        { method: "GET" },
        fetchImpl
    );
    if (!result.ok) return { error: result.error };
    if (!isPlainObject(result.data)) {
        return { error: "el producto no existe en Mastershop" };
    }
    const product = normalizeMastershopProduct(result.data);
    if (!product) {
        return { error: "el producto de Mastershop llegó con datos inválidos" };
    }
    if (product.productId !== productId) {
        return { error: "el producto del proveedor no coincide con el id solicitado" };
    }
    return { product };
}

// Account-membership check: the account product list endpoint answers whether
// the product was added to "Mis productos". 404 is a clean negative; any
// malformed 200 envelope is an error, never a silent false.
export async function mastershopProductBelongsToAccount(
    productId: string,
    fetchImpl?: FetchLike
): Promise<MastershopResult<boolean>> {
    if (!isValidMastershopProductId(productId)) {
        return { ok: false, error: "invalid product id" };
    }
    const result = await mastershopRequest(
        `/api/products/${encodeURIComponent(productId)}?includeAllVariations=true`,
        { method: "GET" },
        fetchImpl
    );
    if (!result.ok) {
        if (result.status === 404) return { ok: true, data: false };
        return { ok: false, error: result.error, status: result.status };
    }
    const body = result.data;
    if (!isPlainObject(body) || !Array.isArray(body.results) || body.results.length !== 1) {
        return { ok: false, error: "Mastershop devolvió una respuesta inesperada." };
    }
    const row = body.results[0];
    if (!isPlainObject(row) || mastershopProductId(row.idProduct) !== productId) {
        return { ok: false, error: "Mastershop devolvió una respuesta inesperada." };
    }
    return { ok: true, data: true };
}

export async function previewMastershopProduct(
    productId: string,
    variantId?: string,
    fetchImpl?: FetchLike
): Promise<{ preview: SupplierPreview } | { error: string }> {
    const result = await getMastershopProduct(productId, fetchImpl);
    if ("error" in result) return result;
    const product = result.product;

    const warnings: string[] = [];
    if (!product.description) warnings.push("Mastershop no devolvió descripción; complétala antes de publicar.");
    if (!product.category) warnings.push("Mastershop no devolvió una categoría legible; asígnala en el borrador.");
    if (product.images.length === 0) warnings.push("Mastershop no devolvió imágenes; agrega imágenes con derecho de uso antes de publicar.");
    if (product.variants.every((v) => v.stock === null)) warnings.push("Mastershop no reportó stock; el borrador se importará con 0 hasta verificar.");
    if (product.variants.every((v) => v.price === null)) warnings.push("Mastershop no devolvió precios válidos; el costo quedará pendiente.");

    let selectedVariantId: string | null = null;
    if (variantId) {
        if (!product.variants.some((v) => v.id === variantId)) {
            return { error: "la variante seleccionada no pertenece a este producto" };
        }
        selectedVariantId = variantId;
    } else if (product.variants.length === 1) {
        selectedVariantId = product.variants[0].id;
    } else if (product.variants.length > 1) {
        warnings.push("El producto tiene varias variantes; elige una antes de importar.");
    }

    const selected = product.variants.find((v) => v.id === selectedVariantId);
    if (selected) {
        if (selected.stock === null) {
            warnings.push("El stock de la variante seleccionada no fue verificado; el borrador se importará con stock 0.");
        } else if (selected.stock === 0) {
            warnings.push("La variante seleccionada no tiene stock disponible actualmente.");
        }
        if (selected.price === null) {
            warnings.push("Mastershop no devolvió precio para la variante seleccionada; el costo quedará pendiente.");
        }
    }
    warnings.push("La cotización de envío no es automática: confirma el costo de envío a la ciudad del cliente y regístralo en el borrador antes de publicar.");
    warnings.push("Agrega el producto a «Mis productos» en Mastershop antes de vender: la disponibilidad de fulfillment depende de tu cuenta.");

    return {
        preview: {
            product,
            selectedVariantId,
            freight: [],
            freightDestination: "Colombia — cotización pendiente",
            freightCheckedAt: null,
            fx: null,
            warnings,
        },
    };
}
