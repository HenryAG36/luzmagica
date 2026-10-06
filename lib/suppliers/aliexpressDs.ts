import { createHmac, randomBytes } from "crypto";
import { fetchJson } from "../trends/http.ts";
import type { FetchLike } from "../trends/http.ts";
import type { DsProduct, DsSku } from "./types.ts";

export type { DsProduct, DsSku } from "./types.ts";

const API_BASE = "https://api-sg.aliexpress.com";
const REST_BASE = `${API_BASE}/rest`;
const SYNC_BASE = `${API_BASE}/sync`;
const AUTHORIZE_URL = `${API_BASE}/oauth/authorize`;

const TOKEN_CREATE_PATH = "/auth/token/create";
const TOKEN_REFRESH_PATH = "/auth/token/refresh";
const PRODUCT_GET_API = "aliexpress.ds.product.get";

const PRODUCT_ID_PATTERN = /^\d{6,20}$/;
const MAX_SKUS = 200;
const MAX_IMAGES = 20;
const MAX_TEXT = 20000;

export interface AliExpressDsConfig {
    appKey: string;
    appSecret: string;
    redirectUri: string;
}

export interface DsTokenSet {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string;
    refreshExpiresAt: string | null;
}

export interface ProviderResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
    deferSeconds?: number;
}

export function generateOAuthState(): string {
    return randomBytes(16).toString("hex");
}

export function packStateCookie(state: string, adminUserId: string): string {
    return `${state}.${adminUserId}`;
}

export function validateDsCallback(
    cookieValue: string | undefined,
    stateParam: string | null,
    adminUserId: string
): { ok: true; state: string } | { ok: false; reason: string } {
    if (!stateParam) return { ok: false, reason: "missing_state" };
    if (!cookieValue) return { ok: false, reason: "missing_cookie" };
    const sep = cookieValue.lastIndexOf(".");
    if (sep < 1) return { ok: false, reason: "malformed_cookie" };
    const expectedState = cookieValue.slice(0, sep);
    const boundUser = cookieValue.slice(sep + 1);
    if (boundUser !== adminUserId) return { ok: false, reason: "wrong_user" };
    if (expectedState !== stateParam) return { ok: false, reason: "state_mismatch" };
    return { ok: true, state: expectedState };
}

export function buildAuthorizationUrl(
    config: Pick<AliExpressDsConfig, "appKey" | "redirectUri">,
    state: string
): string {
    const params = new URLSearchParams({
        response_type: "code",
        force_auth: "true",
        redirect_uri: config.redirectUri,
        client_id: config.appKey,
        state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function signApiRequest(
    apiName: string,
    params: Record<string, string>,
    appSecret: string
): string {
    const keys = Object.keys(params)
        .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== "")
        .sort();
    let base = apiName;
    for (const key of keys) base += key + params[key];
    return createHmac("sha256", appSecret).update(base, "utf8").digest("hex").toUpperCase();
}

export function buildSignedRequestUrl(
    apiName: string,
    config: AliExpressDsConfig,
    apiParams: Record<string, string>,
    accessToken?: string,
    nowMs: number = Date.now()
): string {
    const isPathStyle = apiName.includes("/");
    const all: Record<string, string> = {
        ...apiParams,
        method: apiName,
        app_key: config.appKey,
        timestamp: String(nowMs),
        sign_method: "sha256",
        simplify: "true",
    };
    if (accessToken) all.session = accessToken;

    const signParams = { ...all };
    if (isPathStyle) delete signParams.method;
    const sign = isPathStyle
        ? signApiRequest(apiName, signParams, config.appSecret)
        : signApiRequest("", signParams, config.appSecret);

    const queryParams = { ...all };
    if (isPathStyle) delete queryParams.method;
    const query = Object.entries(queryParams)
        .filter(([, v]) => v != null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
    const base = isPathStyle ? `${REST_BASE}${apiName}` : SYNC_BASE;
    return `${base}?${query}&sign=${sign}`;
}

interface DsTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    expire_time?: number;
    refresh_expires_in?: number;
    refresh_token_valid_time?: number;
    code?: string;
    msg?: string;
    sub_msg?: string;
}

function epochMsToIso(value: unknown): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    const ms = value <= Number.MAX_SAFE_INTEGER ? value : null;
    if (ms === null) return null;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function secondsToIso(value: unknown): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    const date = new Date(Date.now() + value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeDsTokenResponse(raw: unknown): DsTokenSet | null {
    if (typeof raw !== "object" || raw === null) return null;
    const data = raw as DsTokenResponse;
    if (data.code !== undefined && String(data.code) !== "0") return null;
    if (typeof data.access_token !== "string" || data.access_token === "") return null;

    const expiresAt = epochMsToIso(data.expire_time) ?? secondsToIso(data.expires_in);
    if (!expiresAt) return null;
    const refreshExpiresAt =
        epochMsToIso(data.refresh_token_valid_time) ?? secondsToIso(data.refresh_expires_in);
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === "string" && data.refresh_token !== "" ? data.refresh_token : null,
        expiresAt,
        refreshExpiresAt,
    };
}

async function tokenRequest(
    apiName: string,
    params: Record<string, string>,
    config: AliExpressDsConfig,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<DsTokenSet>> {
    const url = buildSignedRequestUrl(apiName, config, params);
    const res = await fetchJson<DsTokenResponse>(url, { method: "POST" }, { fetchImpl, deadlineMs });
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const data = res.data;
    if (data?.code !== undefined && String(data.code) !== "0") {
        return { ok: false, error: `token api error ${data.code}` };
    }
    const tokens = normalizeDsTokenResponse(data);
    if (!tokens) return { ok: false, error: "token response missing access_token" };
    return { ok: true, data: tokens };
}

export function exchangeCodeForTokens(
    code: string,
    config: AliExpressDsConfig,
    fetchImpl?: FetchLike
): Promise<ProviderResult<DsTokenSet>> {
    return tokenRequest(TOKEN_CREATE_PATH, { code }, config, fetchImpl);
}

export function refreshAccessToken(
    refreshToken: string,
    config: AliExpressDsConfig,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<DsTokenSet>> {
    return tokenRequest(TOKEN_REFRESH_PATH, { refresh_token: refreshToken }, config, fetchImpl, deadlineMs);
}

export function isValidDsProductId(value: unknown): value is string {
    return typeof value === "string" && PRODUCT_ID_PATTERN.test(value);
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => {
            const cp = Number(n);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
        });
}

export function stripHtmlToText(html: unknown): string {
    if (typeof html !== "string") return "";
    return decodeEntities(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
    )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TEXT);
}

function normalizeSku(raw: unknown): DsSku | null {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const skuId = o.sku_id ?? o.id;
    if (typeof skuId !== "string" && typeof skuId !== "number") return null;
    const attr = o.sku_attr;
    return {
        skuId: String(skuId),
        skuAttr: typeof attr === "string" && attr ? attr.slice(0, 200) : null,
        offerSalePrice: parseNumber(o.offer_sale_price),
        skuPrice: parseNumber(o.sku_price),
        currency: typeof o.currency_code === "string" ? o.currency_code : null,
        availableStock: parseNumber(o.sku_available_stock),
    };
}

function normalizeImages(raw: unknown): string[] {
    const urls: string[] = [];
    if (typeof raw === "string") {
        urls.push(...raw.split(/[;,]/).map((u) => u.trim()));
    } else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === "string") urls.push(item.trim());
        }
    }
    return urls.filter((u) => /^https:\/\//i.test(u)).slice(0, MAX_IMAGES);
}

export function normalizeDsProduct(raw: unknown, productId: string): DsProduct | null {
    if (typeof raw !== "object" || raw === null) return null;
    const root = (raw as Record<string, unknown>).aliexpress_ds_product_get_response;
    if (typeof root !== "object" || root === null) return null;
    const resp = root as Record<string, unknown>;

    const base = typeof resp.result === "object" && resp.result !== null
        ? (resp.result as Record<string, unknown>).ae_item_base_info_dto
        : null;
    if (typeof base !== "object" || base === null) return null;
    const baseInfo = base as Record<string, unknown>;

    const title = typeof baseInfo.subject === "string" ? baseInfo.subject.trim() : "";
    if (!title) return null;

    const result = resp.result as Record<string, unknown>;
    const skuList = Array.isArray(result.ae_item_sku_info_dtos)
        ? result.ae_item_sku_info_dtos
        : [];
    const skus = skuList.map(normalizeSku).filter((s): s is DsSku => s !== null).slice(0, MAX_SKUS);

    const multimedia = typeof result.ae_multimedia_info_dto === "object" && result.ae_multimedia_info_dto !== null
        ? (result.ae_multimedia_info_dto as Record<string, unknown>)
        : {};
    const images = normalizeImages(multimedia.image_urls);

    const logistics = typeof result.logistics_info_dto === "object" && result.logistics_info_dto !== null
        ? (result.logistics_info_dto as Record<string, unknown>)
        : {};

    return {
        productId: String(baseInfo.product_id ?? productId),
        title: title.slice(0, 200),
        descriptionText: stripHtmlToText(baseInfo.detail),
        categoryId: baseInfo.category_id != null ? String(baseInfo.category_id) : null,
        currency: typeof baseInfo.currency_code === "string" ? baseInfo.currency_code : null,
        providerReportedSales: parseNumber(baseInfo.sales_count),
        images,
        skus,
        deliveryTimeDays: parseNumber(logistics.delivery_time),
        sourceUrl: `https://www.aliexpress.com/item/${encodeURIComponent(productId)}.html`,
    };
}

export function getDsResponseError(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) return "malformed response";
    const body = raw as Record<string, unknown>;
    const err = body.error_response;
    if (typeof err === "object" && err !== null) {
        const code = (err as Record<string, unknown>).code;
        return `provider error ${typeof code === "string" || typeof code === "number" ? code : "unknown"}`;
    }
    const root = body.aliexpress_ds_product_get_response;
    if (typeof root !== "object" || root === null) return "malformed response";
    const resp = root as Record<string, unknown>;
    const rspCode = resp.rsp_code;
    if (String(rspCode) !== "200") {
        return `provider rsp_code ${String(rspCode)}`;
    }
    return null;
}

export async function fetchDsProduct(
    accessToken: string,
    productId: string,
    config: AliExpressDsConfig,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<DsProduct>> {
    const url = buildSignedRequestUrl(
        PRODUCT_GET_API,
        config,
        {
            product_id: productId,
            ship_to_country: "CO",
            target_currency: "USD",
            target_language: "es",
            remove_personal_benefit: "true",
        },
        accessToken
    );
    const res = await fetchJson<unknown>(url, { method: "POST" }, { fetchImpl, deadlineMs });
    if (!res.ok) {
        return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }
    const responseError = getDsResponseError(res.data);
    if (responseError) return { ok: false, error: responseError };
    const product = normalizeDsProduct(res.data, productId);
    if (!product) return { ok: false, error: "product response malformed" };
    return { ok: true, data: product };
}

export function buildDsProviderItemId(productId: string, skuId: string): string {
    return `${productId}-${skuId}`;
}
