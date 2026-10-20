// CJ Dropshipping catalog lookups: product detail, CN stock and CN→CO freight.
// Official docs: https://developers.cjdropshipping.com/en/api/api2/api/product.html
// All functions take an already-issued CJ-Access-Token; the caller owns the
// provider lease so a preview performs detail → stock → freight sequentially.

import { stripHtmlToText } from "./aliexpressDs.ts";
import { cjFetch, type CjResult } from "./cjdropshipping.ts";
import { cjChinaStock } from "../catalog/supplierImport.ts";
import type {
    SupplierFreight,
    SupplierProduct,
    SupplierVariant,
} from "../catalog/supplierImport.ts";
import type { FetchLike } from "../trends/http.ts";
import { isHttpUrl } from "../catalog/validate.ts";

const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const DETAIL_PATH = "/product/query";
const STOCK_PATH = "/product/stock/queryByVid";
const FREIGHT_PATH = "/logistic/freightCalculate";

const MAX_VARIANTS = 100;
const MAX_IMAGES = 10;
const MAX_DETAIL_TEXT = 120;

export function isValidCjId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function boundedText(value: unknown, max = MAX_DETAIL_TEXT): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed || null;
}

function boundedNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
}

function safeImage(value: unknown): string | null {
    return typeof value === "string" && isHttpUrl(value) ? value : null;
}

export function getCjResponseErrorCode(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) return "malformed response";
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) {
        return `provider error code ${String(body.code)}`;
    }
    return null;
}

// --- Product detail -------------------------------------------------------

export function normalizeCjCatalogProduct(
    raw: unknown,
    requestedId: string
): SupplierProduct | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;

    if (typeof d.pid !== "string" || d.pid !== requestedId) return null;
    const title = boundedText(d.productNameEn, 200);
    if (!title) return null;

    const imageSet = Array.isArray(d.productImageSet) ? d.productImageSet : [];
    const images = [...new Set([safeImage(d.bigImage), ...imageSet.map(safeImage)]
        .filter((v): v is string => v !== null))].slice(0, MAX_IMAGES);

    const categoryRaw = boundedText(d.categoryName);
    const category = categoryRaw
        ? categoryRaw.split(/[/›>]/).map((s) => s.trim()).filter(Boolean).pop()?.slice(0, 80) ?? null
        : null;

    const variantsRaw = Array.isArray(d.variants) ? d.variants : [];
    const variants: SupplierVariant[] = [];
    for (const v of variantsRaw.slice(0, MAX_VARIANTS)) {
        if (typeof v !== "object" || v === null) continue;
        const o = v as Record<string, unknown>;
        if (!isValidCjId(o.vid)) continue;
        variants.push({
            id: o.vid,
            label: boundedText(o.variantNameEn, 120) ?? boundedText(o.variantKey, 120) ?? o.vid,
            price: boundedNumber(o.variantSellPrice),
            currency: "USD",
            stock: cjChinaStock(o.inventories, "totalInventory"),
            image: safeImage(o.variantImage),
            attributes: {
                variant_sku: boundedText(o.variantSku),
                weight_g: boundedNumber(o.variantWeight),
                length_mm: boundedNumber(o.variantLength),
                width_mm: boundedNumber(o.variantWidth),
                height_mm: boundedNumber(o.variantHeight),
            },
        });
    }

    const details: Record<string, string | number | null> = {
        product_sku: boundedText(d.productSku),
        weight_g: boundedNumber(d.productWeight),
        product_unit: boundedText(d.productUnit, 60),
    };
    for (const [key, raw] of [
        ["materials", d.materialNameEnSet],
        ["logistics_attributes", d.productProEnSet],
    ] as const) {
        if (Array.isArray(raw)) {
            const list = raw
                .map((item) => boundedText(item, 60))
                .filter((v): v is string => v !== null)
                .slice(0, 20);
            if (list.length > 0) details[key] = list.join(", ");
        }
    }

    return {
        source: "cjdropshipping",
        productId: d.pid,
        title,
        description: stripHtmlToText(d.description),
        category,
        images,
        // CJ public product URLs are queryable only via their site search;
        // no canonical URL is returned by the API, so none is fabricated.
        sourceUrl: null,
        variants,
        details,
        fetchedAt: new Date().toISOString(),
    };
}

export async function fetchCjProductDetail(
    accessToken: string,
    productId: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<SupplierProduct>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DETAIL_PATH}?pid=${encodeURIComponent(productId)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const product = normalizeCjCatalogProduct(res.data, productId);
    if (!product) return { ok: false, error: "product detail malformed" };
    return { ok: true, data: product };
}

// --- Variant stock (CN warehouses only — freight ships CN → CO) -----------

// Documented response: data is a flat array of per-country rows
// {vid, countryCode, totalInventoryNum, cjInventoryNum, factoryInventoryNum,
//  stock:[{stockId, inventory, factoryInventory}]}. The nested `stock` leaf
// numbers are per-warehouse internals and must NOT be summed — only the
// country-level totals are used.
export function normalizeCjStock(raw: unknown, vid: string): number | null {
    if (!raw || typeof raw !== "object") return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true || !Array.isArray(body.data)) return null;
    const rows = body.data.filter(
        (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object" && !Array.isArray(entry)
    );
    if (rows.some((row) => row.vid !== undefined && row.vid !== vid)) return null;
    return cjChinaStock(rows, "totalInventoryNum");
}

export async function fetchCjVariantStock(
    accessToken: string,
    vid: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<number | null>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${STOCK_PATH}?vid=${encodeURIComponent(vid)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const body = res.data as Record<string, unknown> | undefined;
    if (!body || Number(body.code) !== 200 || body.result !== true) {
        return { ok: false, error: "stock response malformed" };
    }
    return { ok: true, data: normalizeCjStock(res.data, vid) };
}

// --- Freight quote CN → CO -------------------------------------------------

function freightFeeUsd(entry: Record<string, unknown>): number | null {
    // A supplied-but-invalid totalPostageFee must not silently fall back to
    // partial fees — it voids the price.
    if (entry.totalPostageFee !== undefined && entry.totalPostageFee !== null) {
        return boundedNumber(entry.totalPostageFee);
    }
    const logistic = boundedNumber(entry.logisticPrice);
    if (logistic === null) return null;
    const taxes = entry.taxesFee === undefined || entry.taxesFee === null
        ? 0
        : boundedNumber(entry.taxesFee);
    const clearance =
        entry.clearanceOperationFee === undefined || entry.clearanceOperationFee === null
            ? 0
            : boundedNumber(entry.clearanceOperationFee);
    // A fee field that was supplied but is not a valid amount invalidates the
    // option rather than silently ignoring it.
    if (taxes === null || clearance === null) return null;
    const sum = logistic + taxes + clearance;
    return Number.isFinite(sum) ? sum : null;
}

export function normalizeCjFreightOptions(raw: unknown): SupplierFreight[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (!Array.isArray(data)) return null;
    const out: SupplierFreight[] = [];
    const seen = new Map<string, number>();
    for (const entry of data) {
        if (typeof entry !== "object" || entry === null) continue;
        const o = entry as Record<string, unknown>;
        const name = boundedText(o.logisticName, 80);
        if (!name) continue;
        // logisticName is the stable identity; identical names dedupe.
        if (seen.has(name)) continue;
        seen.set(name, out.length);
        const fee = freightFeeUsd(o);
        const aging = boundedText(o.logisticAging, 60);
        out.push({ id: name, label: name, feeUsd: fee, delivery: aging });
        if (out.length >= 20) break;
    }
    return out;
}

export async function fetchCjFreight(
    accessToken: string,
    vid: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<SupplierFreight[]>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${FREIGHT_PATH}`,
        {
            method: "POST",
            headers: {
                "CJ-Access-Token": accessToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                startCountryCode: "CN",
                endCountryCode: "CO",
                products: [{ quantity: 1, vid }],
            }),
        },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const options = normalizeCjFreightOptions(res.data);
    if (options === null) return { ok: false, error: "freight response malformed" };
    return { ok: true, data: options };
}
