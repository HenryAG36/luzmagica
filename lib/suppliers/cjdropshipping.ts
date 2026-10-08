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

const ORDER_DETAIL_PATH = "/shopping/order/getOrderDetail";
const TRACK_INFO_PATH = "/logistic/trackInfo";
const DISPUTE_PRODUCTS_PATH = "/disputes/disputeProducts";
const DISPUTE_CONFIRM_PATH = "/disputes/disputeConfirmInfo";
const DISPUTE_CREATE_PATH = "/disputes/create";
const DISPUTE_DETAIL_PATH = "/disputes/getDisputeDetail";
const DISPUTE_UPLOAD_PATH = "/disputes/uploadFile";

export interface CjOrderDetail {
    orderId: string | null;
    orderNum: string | null;
    orderStatus: string | null;
    logisticName: string | null;
    trackNumber: string | null;
    trackingUrl: string | null;
}

export function normalizeCjOrderDetail(raw: unknown): CjOrderDetail | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 200) : null;
    return {
        orderId: str(d.orderId),
        orderNum: str(d.orderNum),
        orderStatus: str(d.orderStatus),
        logisticName: str(d.logisticName),
        trackNumber: str(d.trackNumber),
        trackingUrl: str(d.trackingUrl),
    };
}

// orderId accepts the custom order number (our ref) or the CJ order id.
export async function fetchCjOrderDetail(
    accessToken: string,
    orderId: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjOrderDetail>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${ORDER_DETAIL_PATH}?orderId=${encodeURIComponent(orderId)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const detail = normalizeCjOrderDetail(res.data);
    if (!detail) return { ok: false, error: "order detail malformed" };
    return { ok: true, data: detail };
}

export interface CjTrackInfo {
    trackingNumber: string;
    logisticName: string | null;
    trackingStatus: string | null;
    deliveryTime: string | null;
    lastMileCarrier: string | null;
    lastTrackNumber: string | null;
}

export function normalizeCjTrackInfo(raw: unknown): CjTrackInfo[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (!Array.isArray(data)) return null;
    const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 200) : null;
    const out: CjTrackInfo[] = [];
    for (const entry of data.slice(0, 10)) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const trackingNumber = str(e.trackingNumber);
        if (!trackingNumber) continue;
        out.push({
            trackingNumber,
            logisticName: str(e.logisticName),
            trackingStatus: str(e.trackingStatus),
            deliveryTime: str(e.deliveryTime),
            lastMileCarrier: str(e.lastMileCarrier),
            lastTrackNumber: str(e.lastTrackNumber),
        });
    }
    return out;
}

export async function fetchCjTrackInfo(
    accessToken: string,
    trackNumber: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjTrackInfo[]>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${TRACK_INFO_PATH}?trackNumber=${encodeURIComponent(trackNumber)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const info = normalizeCjTrackInfo(res.data);
    if (!info) return { ok: false, error: "track info malformed" };
    return { ok: true, data: info };
}

// ---------- disputes ----------

export interface CjDisputeProduct {
    lineItemId: string;
    cjProductId: string | null;
    cjVariantId: string | null;
    canChoose: boolean;
    price: number | null;
    quantity: number | null;
    cjProductName: string | null;
}

export function normalizeCjDisputeProducts(raw: unknown): CjDisputeProduct[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const list = (data as Record<string, unknown>).productInfoList;
    if (!Array.isArray(list)) return null;
    const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    const out: CjDisputeProduct[] = [];
    for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const lineItemId = str(e.lineItemId);
        if (!lineItemId) continue;
        out.push({
            lineItemId,
            cjProductId: str(e.cjProductId),
            cjVariantId: str(e.cjVariantId),
            canChoose: e.canChoose === true,
            price: parseNumber(e.price),
            quantity: parseIntField(e.quantity),
            cjProductName: str(e.cjProductName),
        });
    }
    return out;
}

export async function fetchCjDisputeProducts(
    accessToken: string,
    orderId: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjDisputeProduct[]>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DISPUTE_PRODUCTS_PATH}?orderId=${encodeURIComponent(orderId)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const products = normalizeCjDisputeProducts(res.data);
    if (!products) return { ok: false, error: "dispute products malformed" };
    return { ok: true, data: products };
}

export interface CjDisputeReason {
    disputeReasonId: number;
    reasonName: string;
}

export interface CjDisputeConfirmInfo {
    maxAmount: number | null;
    reasons: CjDisputeReason[];
}

export function normalizeCjDisputeConfirm(raw: unknown): CjDisputeConfirmInfo | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    const list = d.disputeReasonList;
    const reasons: CjDisputeReason[] = [];
    if (Array.isArray(list)) {
        for (const entry of list) {
            if (typeof entry !== "object" || entry === null) continue;
            const e = entry as Record<string, unknown>;
            const id = parseIntField(e.disputeReasonId);
            const name = typeof e.reasonName === "string" ? e.reasonName.trim().slice(0, 200) : null;
            if (id === null || !name) continue;
            reasons.push({ disputeReasonId: id, reasonName: name });
        }
    }
    return { maxAmount: parseNumber(d.maxAmount), reasons };
}

// Preview step required by CJ before createDispute — returns the valid
// disputeReasonIds for this order, so the caller picks from the provider's
// own list instead of guessing ids.
export async function fetchCjDisputeConfirmInfo(
    accessToken: string,
    orderId: string,
    products: { lineItemId: string; quantity: number; price: number }[],
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjDisputeConfirmInfo>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DISPUTE_CONFIRM_PATH}`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({
                orderId,
                productInfoList: products.map((p) => ({
                    lineItemId: p.lineItemId,
                    quantity: p.quantity,
                    price: p.price,
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
    const info = normalizeCjDisputeConfirm(res.data);
    if (!info) return { ok: false, error: "dispute confirm malformed" };
    return { ok: true, data: info };
}

export interface CjUploadedFile {
    url: string;
    fileType: "IMAGE" | "VIDEO" | null;
}

export function normalizeCjUploadFile(raw: unknown): CjUploadedFile | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (typeof d.url !== "string" || d.url === "") return null;
    const fileType = d.fileType === "IMAGE" || d.fileType === "VIDEO" ? d.fileType : null;
    return { url: d.url, fileType };
}

// Copies a publicly reachable file onto CJ's CDN — our private-bucket
// signed URLs work because CJ downloads synchronously during the call.
export async function uploadCjDisputeFile(
    accessToken: string,
    fileUrl: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjUploadedFile>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DISPUTE_UPLOAD_PATH}`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({ fileUrl }),
        },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const uploaded = normalizeCjUploadFile(res.data);
    if (!uploaded) return { ok: false, error: "upload response malformed" };
    return { ok: true, data: uploaded };
}

export interface CjDisputeCreateSpec {
    orderId: string;
    businessDisputeId: string;
    disputeReasonId: number;
    messageText: string;
    imageUrls: string[];
    videoUrls: string[];
    products: { lineItemId: string; quantity: number; price: number }[];
}

export async function createCjDispute(
    accessToken: string,
    spec: CjDisputeCreateSpec,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<{ ok: true }>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DISPUTE_CREATE_PATH}`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({
                orderId: spec.orderId,
                businessDisputeId: spec.businessDisputeId.slice(0, 100),
                disputeReasonId: spec.disputeReasonId,
                expectType: 1,
                refundType: 1,
                messageText: spec.messageText.slice(0, 500),
                imageUrl: spec.imageUrls,
                videoUrl: spec.videoUrls,
                productInfoList: spec.products.map((p) => ({
                    lineItemId: p.lineItemId,
                    quantity: p.quantity,
                    price: p.price,
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
    return { ok: true, data: { ok: true } };
}

export interface CjDisputeDetail {
    id: string;
    status: string | null;
    disputeReason: string | null;
    refundAmount: number | null;
}

export function normalizeCjDisputeDetail(raw: unknown): CjDisputeDetail | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as Record<string, unknown>;
    if (Number(body.code) !== 200 || body.result !== true) return null;
    const data = body.data;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 200) : null;
    const id = str(d.id);
    if (!id) return null;
    return {
        id,
        status: str(d.status),
        disputeReason: str(d.disputeReason),
        refundAmount: parseNumber(d.refundAmount),
    };
}

export async function fetchCjDisputeDetail(
    accessToken: string,
    disputeId: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<CjResult<CjDisputeDetail>> {
    const res = await cjFetch<unknown>(
        `${CJ_API_BASE}${DISPUTE_DETAIL_PATH}?disputeId=${encodeURIComponent(disputeId)}`,
        { method: "GET", headers: { "CJ-Access-Token": accessToken } },
        deadlineMs,
        fetchImpl
    );
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getCjResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const detail = normalizeCjDisputeDetail(res.data);
    if (!detail) return { ok: false, error: "dispute detail malformed" };
    return { ok: true, data: detail };
}
