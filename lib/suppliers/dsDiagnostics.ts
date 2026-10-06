import { randomUUID } from "crypto";
import { getAliExpressDsEnv, getEncryptionSecret } from "../env.ts";
import type { FetchLike } from "../trends/http.ts";
import { LEASE_TTL_SECONDS, REFRESH_DEADLINE_MS } from "../trends/freshness.ts";
import {
    acquireProviderLease,
    markConnectionError,
    releaseProviderLease,
} from "../trends/service.ts";
import type { SupabaseClientLike } from "../supabase/types.ts";
import { getDsAccessToken } from "./dsService.ts";
import { buildSignedRequestUrl } from "./aliexpressDs.ts";

const ALLOWLISTED_KEYS = new Set([
    "code",
    "ret",
    "rsp_code",
    "rsp_msg",
    "result",
    "products",
    "search_id",
    "total",
    "aliexpress_ds_feedname_get_response",
    "aliexpress_ds_feed_itemids_get_response",
    "error_response",
    "feed_names",
    "feed_name",
    "feeds",
]);

const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const FEED_NAME_MAX = 20;
const FEED_NAME_LENGTH = 80;

export interface DsDiagnosticShape {
    rootKeys: string[];
    wrapperKeys: string[];
    resultKeys: string[];
    unknownKeyCount: number;
    productsType: string;
    productCount: number | null;
    feedNames: string[];
}

export interface DsDiagnosticCodes {
    code: string | null;
    rspCode: string | null;
    ret: boolean | null;
}

export interface DsDiagnosticTest {
    name: string;
    httpStatus: number | null;
    ok: boolean;
    shape: DsDiagnosticShape;
    codes: DsDiagnosticCodes;
}

export interface DsDiagnosticsReport {
    checkedAt: string;
    tests: DsDiagnosticTest[];
}

export const DS_DIAGNOSTIC_CALLS: { name: string; params: Record<string, string> }[] = [
    { name: "aliexpress.ds.feedname.get", params: {} },
    {
        name: "aliexpress.ds.feed.itemids.get",
        params: { feed_name: "DS bestseller", page_size: "10" },
    },
];

function allowlistedKeys(obj: unknown, counter: { unknown: number }): string[] {
    if (typeof obj !== "object" || obj === null) return [];
    const keys: string[] = [];
    for (const key of Object.keys(obj)) {
        if (ALLOWLISTED_KEYS.has(key)) keys.push(key);
        else counter.unknown += 1;
    }
    return keys.sort();
}

function containsSecret(value: string, secrets: string[]): boolean {
    return secrets.some((s) => s !== "" && value.includes(s));
}

function sanitizeCode(value: unknown, secrets: string[]): string | null {
    if (typeof value === "string" && CODE_PATTERN.test(value)) {
        return containsSecret(value, secrets) ? null : value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const s = String(value);
        return CODE_PATTERN.test(s) && !containsSecret(s, secrets) ? s : null;
    }
    return null;
}

function sanitizeRet(value: unknown): boolean | null {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
}

function sanitizeFeedName(value: unknown, secrets: string[]): string | null {
    if (typeof value !== "string" || value.length === 0) return null;
    if (containsSecret(value, secrets)) return "[redacted]";
    return value.slice(0, FEED_NAME_LENGTH);
}

function extractFeedNames(result: Record<string, unknown>, secrets: string[]): string[] {
    const out: string[] = [];
    const push = (value: unknown) => {
        if (out.length >= FEED_NAME_MAX) return;
        const name =
            typeof value === "string"
                ? value
                : typeof value === "object" && value !== null
                  ? (value as Record<string, unknown>).feed_name
                  : null;
        const safe = sanitizeFeedName(name, secrets);
        if (safe !== null && !out.includes(safe)) out.push(safe);
    };
    if (Array.isArray(result.feed_names)) for (const v of result.feed_names) push(v);
    if (Array.isArray(result.feeds)) for (const v of result.feeds) push(v);
    return out;
}

export function summarizeDiagnosticResponse(
    method: string,
    httpStatus: number | null,
    raw: unknown,
    secrets: string[] = []
): DsDiagnosticTest {
    const counter = { unknown: 0 };
    const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const wrapperName = `${method.replace(/\./g, "_")}_response`;
    const wrapped =
        typeof body[wrapperName] === "object" && body[wrapperName] !== null
            ? (body[wrapperName] as Record<string, unknown>)
            : null;
    const inner = wrapped ?? body;
    const result =
        typeof inner.result === "object" && inner.result !== null
            ? (inner.result as Record<string, unknown>)
            : {};

    const rootKeys = allowlistedKeys(body, counter);
    const wrapperKeys = wrapped ? allowlistedKeys(wrapped, counter) : [];
    const resultKeys = allowlistedKeys(result, counter);

    const errorResponse =
        typeof body.error_response === "object" && body.error_response !== null
            ? (body.error_response as Record<string, unknown>)
            : null;

    const products = result.products;
    const code = sanitizeCode(inner.code, secrets) ?? sanitizeCode(errorResponse?.code, secrets);
    const rspCode = sanitizeCode(inner.rsp_code, secrets);
    const ret = sanitizeRet(inner.ret);
    const httpOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;

    return {
        name: method,
        httpStatus,
        ok:
            httpOk &&
            typeof raw === "object" &&
            raw !== null &&
            errorResponse === null &&
            (inner.code === undefined || code === "0") &&
            (inner.rsp_code === undefined || rspCode === "200") &&
            (inner.ret === undefined || ret === true) &&
            (code === "0" || rspCode === "200" || ret === true),
        shape: {
            rootKeys,
            wrapperKeys,
            resultKeys,
            unknownKeyCount: counter.unknown,
            productsType: Array.isArray(products) ? "array" : typeof products,
            productCount: Array.isArray(products) ? products.length : null,
            feedNames: extractFeedNames(result, secrets),
        },
        codes: { code, rspCode, ret },
    };
}

export async function runDsDiagnostics(
    service: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<{ report: DsDiagnosticsReport } | { error: string }> {
    const env = getAliExpressDsEnv();
    const secret = getEncryptionSecret();
    if (!env || !secret) return { error: "aliexpress ds not configured" };

    const owner = randomUUID();
    const acquired = await acquireProviderLease(service, "aliexpress_ds", owner);
    if (!acquired) return { error: "another ds request is in progress" };

    try {
        const deadlineMs = Date.now() + Math.min(REFRESH_DEADLINE_MS, LEASE_TTL_SECONDS * 1000 - 5000);
        const tokenResult = await getDsAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) {
            await markConnectionError(service, "aliexpress_ds", "diagnostics credential failure");
            return { error: "No se pudieron obtener credenciales para la prueba" };
        }

        const { fetchJson } = await import("../trends/http.ts");
        const secrets = [env.appSecret, env.appKey, tokenResult.token];
        const tests: DsDiagnosticTest[] = [];
        for (const call of DS_DIAGNOSTIC_CALLS) {
            if (Date.now() >= deadlineMs) {
                tests.push(summarizeDiagnosticResponse(call.name, null, null, secrets));
                continue;
            }
            const url = buildSignedRequestUrl(call.name, env, call.params, tokenResult.token);
            const res = await fetchJson<unknown>(url, { method: "POST" }, { fetchImpl, deadlineMs });
            tests.push(
                summarizeDiagnosticResponse(call.name, res.status || null, res.ok ? res.data : null, secrets)
            );
        }
        return { report: { checkedAt: new Date().toISOString(), tests } };
    } finally {
        await releaseProviderLease(service, "aliexpress_ds", owner);
    }
}
