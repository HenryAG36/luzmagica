import { createHash } from "crypto";
import { fetchJson } from "../http.ts";
import type { FetchLike } from "../http.ts";
import type { TrendItem } from "../types.ts";

const GATEWAY_URL = "https://gw.api.taobao.com/router/rest";
const METHOD = "aliexpress.affiliate.hotproduct.query";
const MAX_PRODUCTS = 40;

export function signTopParams(params: Record<string, string>, appSecret: string): string {
    const sorted = Object.keys(params).sort();
    let base = appSecret;
    for (const key of sorted) {
        base += key + params[key];
    }
    base += appSecret;
    return createHash("md5").update(base, "utf8").digest("hex").toUpperCase();
}

export function buildHotProductParams(config: {
    appKey: string;
    trackingId: string;
    timestamp: string;
    keywords?: string;
    shipToCountry?: string;
    targetCurrency?: string;
    pageSize?: number;
}): Record<string, string> {
    const params: Record<string, string> = {
        method: METHOD,
        app_key: config.appKey,
        sign_method: "md5",
        timestamp: config.timestamp,
        format: "json",
        v: "2.0",
        tracking_id: config.trackingId,
        sort: "LAST_VOLUME_DESC",
        ship_to_country: config.shipToCountry || "CO",
        target_currency: config.targetCurrency || "USD",
        page_size: String(Math.min(config.pageSize ?? 20, MAX_PRODUCTS)),
        fields: "product_id,product_title,product_main_image_url,sale_price,sale_price_currency,original_price,lastest_volume,evaluate_rate,discount,product_detail_url,first_level_category_name",
    };
    if (config.keywords) params.keywords = config.keywords;
    return params;
}

interface RawHotProduct {
    product_id?: string | number;
    product_title?: string;
    product_main_image_url?: string;
    sale_price?: string | number;
    sale_price_currency?: string;
    lastest_volume?: string | number;
    evaluate_rate?: string;
    discount?: string | number;
    product_detail_url?: string;
    first_level_category_name?: string;
}

function toNumber(value: string | number | undefined): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

export function normalizeHotProducts(raw: unknown): TrendItem[] {
    if (typeof raw !== "object" || raw === null) return [];
    const resp = raw as Record<string, unknown>;
    const query = resp["aliexpress_affiliate_hotproduct_query_response"] as Record<string, unknown> | undefined;
    const result = (query?.resp_result ?? query?.result ?? resp) as Record<string, unknown>;
    const inner = (result?.result ?? result) as Record<string, unknown>;
    const products = (inner?.products as Record<string, unknown> | undefined)?.product;

    if (!Array.isArray(products)) return [];

    const out: TrendItem[] = [];
    for (const entry of products.slice(0, MAX_PRODUCTS)) {
        if (typeof entry !== "object" || entry === null) continue;
        const p = entry as RawHotProduct;
        const id = p.product_id;
        if (id === undefined || id === null) continue;
        const sourceId = String(id);
        out.push({
            id: `aliexpress-${sourceId}`,
            source: "aliexpress",
            sourceId,
            signalType: "hot_product",
            title: typeof p.product_title === "string" ? p.product_title : sourceId,
            image: typeof p.product_main_image_url === "string" ? p.product_main_image_url : null,
            price: toNumber(p.sale_price),
            currency: typeof p.sale_price_currency === "string" ? p.sale_price_currency : null,
            rank: null,
            salesVolume: toNumber(p.lastest_volume),
            url: typeof p.product_detail_url === "string" ? p.product_detail_url : null,
            category: typeof p.first_level_category_name === "string" ? p.first_level_category_name : null,
        });
    }
    return out;
}

export async function fetchHotProducts(
    config: { appKey: string; appSecret: string; trackingId: string; shipToCountry?: string },
    fetchImpl?: FetchLike
): Promise<{ items: TrendItem[]; error?: string; deferSeconds?: number }> {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const params = buildHotProductParams({
        appKey: config.appKey,
        trackingId: config.trackingId,
        timestamp,
        shipToCountry: config.shipToCountry,
    });
    params.sign = signTopParams(params, config.appSecret);

    const url = `${GATEWAY_URL}?${new URLSearchParams(params).toString()}`;
    const res = await fetchJson<unknown>(url, { method: "GET" }, { fetchImpl });
    if (!res.ok) {
        return { items: [], error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    }

    const errorResp = (res.data as Record<string, unknown>)?.error_response as
        | Record<string, unknown>
        | undefined;
    if (errorResp) {
        return { items: [], error: String(errorResp.msg || "provider error") };
    }

    const query = (res.data as Record<string, unknown>)?.[
        "aliexpress_affiliate_hotproduct_query_response"
    ] as Record<string, unknown> | undefined;
    const respResult = query?.resp_result as Record<string, unknown> | undefined;
    if (respResult && typeof respResult.resp_code === "number" && respResult.resp_code !== 200) {
        return {
            items: [],
            error: `provider rejected request (code ${respResult.resp_code})`,
        };
    }

    return { items: normalizeHotProducts(res.data) };
}
