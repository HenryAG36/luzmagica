import { decryptSecret, encryptSecret } from "../crypto.ts";
import { getCjApiKey, getEncryptionSecret } from "../env.ts";
import type { FetchLike } from "../trends/http.ts";
import type { TrendItem } from "../trends/types.ts";
import type { SupabaseClientLike } from "../supabase/types.ts";
import { getConnection, markConnectionError } from "../trends/service.ts";

export const CJ_PROVIDER = "cjdropshipping";

const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const TOKEN_PATH = "/authentication/getAccessToken";
const LIST_V2_PATH = "/product/listV2";
const MAX_LIST_ITEMS = 20;

export interface CjTokenSet {
    accessToken: string;
    expiresAt: string;
}

export interface CjResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
    deferSeconds?: number;
}

async function cjFetch<T>(url: string, init: RequestInit, deadlineMs?: number, fetchImpl?: FetchLike) {
    const { fetchJson } = await import("../trends/http.ts");
    return fetchJson<T>(url, init, { fetchImpl, deadlineMs });
}

function parseCjExpiry(value: unknown): string | null {
    if (typeof value !== "string" || !value) return null;
    const ts = Date.parse(value);
    if (Number.isNaN(ts) || ts <= Date.now()) return null;
    return new Date(ts).toISOString();
}

export function normalizeCjTokenResponse(raw: unknown): CjTokenSet | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200) return null;
    if (body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const token = (data as Record<string, unknown>).accessToken;
    if (typeof token !== "string" || token === "") return null;
    const expiresAt = parseCjExpiry((data as Record<string, unknown>).accessTokenExpiryDate);
    if (!expiresAt) return null;
    return { accessToken: token, expiresAt };
}

export async function fetchCjAccessToken(
    apiKey: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjTokenSet>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${TOKEN_PATH}`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey }),
        },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const tokens = normalizeCjTokenResponse(res.data);
    if (!tokens) return { ok: false, error: "token response malformed" };
    return { ok: true, data: tokens };
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function parseIntField(value: unknown): number | null {
    const n = parseNumber(value);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function isHttpsUrl(value: unknown): value is string {
    return typeof value === "string" && /^https:\/\//i.test(value);
}

function normalizeCjProduct(raw: unknown): TrendItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    const id = p.id;
    if (typeof id !== "string" && typeof id !== "number") return null;
    const sourceId = String(id);
    if (sourceId.length === 0 || sourceId.length > 128) return null;
    const name = typeof p.nameEn === "string" && p.nameEn.trim() ? p.nameEn.trim().slice(0, 200) : null;
    if (!name) return null;
    return {
        id: `cjdropshipping-${sourceId}`,
        source: "cjdropshipping",
        sourceId,
        signalType: "supplier_trending",
        title: name,
        image: isHttpsUrl(p.bigImage) ? p.bigImage : null,
        price: parseNumber(p.nowPrice) ?? parseNumber(p.sellPrice),
        currency: typeof p.currency === "string" ? p.currency : null,
        rank: null,
        salesVolume: null,
        listingCount: parseIntField(p.listedNum),
        url: null,
        category: typeof p.threeCategoryName === "string" ? p.threeCategoryName.slice(0, 80) : null,
    };
}

export function normalizeCjProductList(raw: unknown): TrendItem[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200) return null;
    if (body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const content = (data as Record<string, unknown>).content;
    if (!Array.isArray(content)) return null;
    const items: TrendItem[] = [];
    for (const page of content) {
        const productList =
            typeof page === "object" && page !== null
                ? (page as Record<string, unknown>).productList
                : null;
        if (!Array.isArray(productList)) continue;
        for (const rawProduct of productList) {
            const item = normalizeCjProduct(rawProduct);
            if (item) items.push(item);
            if (items.length >= MAX_LIST_ITEMS) return items;
        }
    }
    return items;
}

export function getCjResponseError(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) return "malformed response";
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200) {
        return `provider error ${typeof body.code === "string" || typeof body.code === "number" ? body.code : "unknown"}`;
    }
    if (body.result !== true) {
        return "provider result false";
    }
    return null;
}

export async function fetchCjTrendingProducts(
    accessToken: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<TrendItem[]>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${LIST_V2_PATH}?page=1&size=${MAX_LIST_ITEMS}&productFlag=0&orderBy=1&sort=desc`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const items = normalizeCjProductList(res.data);
    if (!items) return { ok: false, error: "product list malformed" };
    return { ok: true, data: items };
}

export async function getCjAccessToken(
    service: SupabaseClientLike,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<{ token: string } | { error: string }> {
    const apiKey = getCjApiKey();
    const secret = getEncryptionSecret();
    if (!apiKey || !secret) return { error: "cjdropshipping not configured" };
    const conn = await getConnection(service, CJ_PROVIDER);

    if (conn?.access_token_encrypted && conn.token_expires_at) {
        const expiresAt = Date.parse(conn.token_expires_at);
        if (!Number.isNaN(expiresAt) && expiresAt > Date.now() + 60_000) {
            const token = decryptSecret(conn.access_token_encrypted, secret);
            return token ? { token } : { error: "stored credentials unreadable" };
        }
    }

    const result = await fetchCjAccessToken(apiKey, fetchImpl, deadlineMs);
    if (!result.ok || !result.data) {
        await markConnectionError(service, CJ_PROVIDER, "token acquisition failed");
        return { error: "token acquisition failed" };
    }

    const { error: persistError } = await service
        .from("provider_connections")
        .upsert(
            {
                provider: CJ_PROVIDER,
                access_token_encrypted: encryptSecret(result.data.accessToken, secret),
                token_expires_at: result.data.expiresAt,
                status: "connected",
                last_error: null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "provider" }
        );

    if (persistError) {
        await markConnectionError(service, CJ_PROVIDER, "credential persistence failed");
        return { error: "credential persistence failed" };
    }

    return { token: result.data.accessToken };
}

const VARIANT_PATH = "/product/variant";
const CREATE_ORDER_PATH = "/shopping/order/createOrderV2";

export interface CjVariant {
    vid: string;
    sku: string | null;
}

function normalizeCjVariants(raw: unknown): CjVariant[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (!Array.isArray(data)) return null;
    const out: CjVariant[] = [];
    for (const v of data) {
        if (typeof v !== "object" || v === null) continue;
        const vid = (v as Record<string, unknown>).vid;
        if (typeof vid !== "string" || vid === "") continue;
        const sku = (v as Record<string, unknown>).variantSku;
        out.push({ vid, sku: typeof sku === "string" ? sku.slice(0, 120) : null });
        if (out.length >= 50) break;
    }
    return out;
}

// Resolves the purchasable variant for a CJ product. Only unambiguous
// single-variant products can be auto-fulfilled; anything else needs the
// operator to fix the supplier_variant snapshot.
export async function fetchCjVariants(
    accessToken: string,
    productId: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjVariant[]>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${VARIANT_PATH}?pid=${encodeURIComponent(productId)}&countryCode=CO`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const variants = normalizeCjVariants(res.data);
    if (!variants) return { ok: false, error: "variant response malformed" };
    return { ok: true, data: variants };
}

export interface CjOrderResult {
    orderId: string | null;
    orderNumber: string | null;
}

function normalizeCjOrderCreate(raw: unknown): CjOrderResult | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return { orderId: null, orderNumber: null };
    const d = data as Record<string, unknown>;
    const orderId = d.orderId;
    const orderNumber = d.orderNumber;
    return {
        orderId: typeof orderId === "string" && orderId !== "" ? orderId : null,
        orderNumber: typeof orderNumber === "string" && orderNumber !== "" ? orderNumber : null,
    };
}

export interface CjOrderSpec {
    orderNumber: string;
    customer: {
        name: string;
        email: string;
        phone: string;
        address: string;
        city: string;
        province: string;
        zip: string;
    };
    products: { vid: string; quantity: number }[];
}

export async function createCjOrder(
    accessToken: string,
    spec: CjOrderSpec,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjOrderResult>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${CREATE_ORDER_PATH}`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({
                orderNumber: spec.orderNumber,
                shippingName: spec.customer.name,
                shippingPhone: spec.customer.phone,
                shippingAddress: spec.customer.address,
                shippingCountryCode: "CO",
                shippingCountry: "Colombia",
                shippingProvince: spec.customer.province,
                shippingCity: spec.customer.city,
                shippingZip: spec.customer.zip,
                email: spec.customer.email,
                products: spec.products.map((p) => ({
                    vid: p.vid,
                    quantity: p.quantity,
                    storeLineItemId: spec.orderNumber,
                })),
            }),
        },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const parsed = normalizeCjOrderCreate(res.data);
    if (!parsed) return { ok: false, error: "order response malformed" };
    return { ok: true, data: parsed };
}
