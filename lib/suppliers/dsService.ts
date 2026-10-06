import { randomUUID } from "crypto";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { getAliExpressDsEnv, getEncryptionSecret } from "../env.ts";
import type { FetchLike } from "../trends/http.ts";
import { LEASE_TTL_SECONDS, REFRESH_DEADLINE_MS } from "../trends/freshness.ts";
import {
    acquireProviderLease,
    getConnection,
    markConnectionError,
    releaseProviderLease,
} from "../trends/service.ts";
import type { SupabaseClientLike } from "../supabase/types.ts";
import * as ds from "./aliexpressDs.ts";

export const DS_PROVIDER = "aliexpress_ds";

export async function getDsAccessToken(
    service: SupabaseClientLike,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<{ token: string } | { error: string }> {
    const env = getAliExpressDsEnv();
    const secret = getEncryptionSecret();
    const conn = await getConnection(service, DS_PROVIDER);
    if (!env || !secret || !conn?.access_token_encrypted) return { error: "no connected credentials" };

    if (conn.token_expires_at && Date.parse(conn.token_expires_at) > Date.now() + 60_000) {
        const token = decryptSecret(conn.access_token_encrypted, secret);
        return token ? { token } : { error: "stored credentials unreadable" };
    }

    if (!conn.refresh_token_encrypted) return { error: "credentials expired" };
    const refreshToken = decryptSecret(conn.refresh_token_encrypted, secret);
    if (!refreshToken) return { error: "stored credentials unreadable" };

    const result = await ds.refreshAccessToken(refreshToken, env, fetchImpl, deadlineMs);
    if (!result.ok || !result.data) {
        await markConnectionError(service, DS_PROVIDER, "token refresh failed");
        return { error: "token refresh failed" };
    }

    const { error: persistError } = await service
        .from("provider_connections")
        .update({
            access_token_encrypted: encryptSecret(result.data.accessToken, secret),
            refresh_token_encrypted: result.data.refreshToken
                ? encryptSecret(result.data.refreshToken, secret)
                : conn.refresh_token_encrypted,
            token_expires_at: result.data.expiresAt,
            status: "connected",
            last_error: null,
            updated_at: new Date().toISOString(),
        })
        .eq("provider", DS_PROVIDER);

    if (persistError) {
        await markConnectionError(service, DS_PROVIDER, "credential persistence failed");
        return { error: "credential persistence failed" };
    }

    return { token: result.data.accessToken };
}

export async function lookupDsProduct(
    service: SupabaseClientLike,
    productId: string,
    fetchImpl?: FetchLike
): Promise<{ product: ds.DsProduct } | { error: string }> {
    if (!ds.isValidDsProductId(productId)) return { error: "invalid product id" };
    if (!getAliExpressDsEnv() || !getEncryptionSecret()) return { error: "aliexpress ds not configured" };

    const owner = randomUUID();
    const acquired = await acquireProviderLease(service, DS_PROVIDER, owner);
    if (!acquired) return { error: "another ds request is in progress" };

    try {
        const deadlineMs = Date.now() + Math.min(REFRESH_DEADLINE_MS, LEASE_TTL_SECONDS * 1000 - 5000);
        const tokenResult = await getDsAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) return { error: tokenResult.error };

        const env = getAliExpressDsEnv();
        if (!env) return { error: "aliexpress ds not configured" };
        const result = await ds.fetchDsProduct(tokenResult.token, productId, env, fetchImpl, deadlineMs);
        if (!result.ok || !result.data) {
            await markConnectionError(service, DS_PROVIDER, result.error || "product lookup failed");
            return { error: result.error || "product lookup failed" };
        }
        return { product: result.data };
    } finally {
        await releaseProviderLease(service, DS_PROVIDER, owner);
    }
}

export async function lookupDsFreight(
    service: SupabaseClientLike,
    productId: string,
    skuId: string,
    fetchImpl?: FetchLike
): Promise<{ quote: ds.DsFreightQuote } | { error: string }> {
    if (!ds.isValidDsProductId(productId)) return { error: "invalid product id" };
    if (typeof skuId !== "string" || skuId.length === 0 || skuId.length > 64) {
        return { error: "invalid sku id" };
    }
    if (!getAliExpressDsEnv() || !getEncryptionSecret()) return { error: "aliexpress ds not configured" };

    const owner = randomUUID();
    const acquired = await acquireProviderLease(service, DS_PROVIDER, owner);
    if (!acquired) return { error: "another ds request is in progress" };

    try {
        const deadlineMs = Date.now() + Math.min(REFRESH_DEADLINE_MS, LEASE_TTL_SECONDS * 1000 - 5000);
        const tokenResult = await getDsAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) return { error: tokenResult.error };

        const env = getAliExpressDsEnv();
        if (!env) return { error: "aliexpress ds not configured" };
        const result = await ds.fetchDsFreightQuote(
            tokenResult.token,
            productId,
            skuId,
            env,
            fetchImpl,
            deadlineMs
        );
        if (!result.ok || !result.data) {
            await markConnectionError(service, DS_PROVIDER, result.error || "freight lookup failed");
            return { error: result.error || "freight lookup failed" };
        }
        return { quote: result.data };
    } finally {
        await releaseProviderLease(service, DS_PROVIDER, owner);
    }
}
