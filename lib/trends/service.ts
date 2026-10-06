import { randomUUID } from "crypto";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { getAliExpressDsEnv, getAliExpressEnv, getCjApiKey, getEncryptionSecret, getMeliCategoryIds, getMeliEnv } from "../env.ts";
import {
    isFresh,
    LEASE_TTL_SECONDS,
    REFRESH_DEADLINE_MS,
    refreshDue,
    RETRY_COOLDOWN_MS,
    SNAPSHOT_TTL_MS,
} from "./freshness.ts";
import type { FetchLike } from "./http.ts";
import * as meli from "./providers/mercadolibre.ts";
import type { SupabaseClientLike } from "../supabase/types.ts";
import * as aliexpress from "./providers/aliexpress.ts";
import type {
    ProviderConnectionRow,
    SnapshotRow,
    SourceStatus,
    TrendItem,
    TrendKeyword,
    TrendSource,
} from "./types.ts";

const SOURCES: TrendSource[] = ["mercadolibre", "aliexpress", "aliexpress_ds", "cjdropshipping"];
const SCOPES: Record<TrendSource, string[]> = {
    mercadolibre: ["search_keywords", "best_sellers"],
    aliexpress: ["hot_products"],
    aliexpress_ds: ["bestseller_feed"],
    cjdropshipping: ["trending_products"],
};
const PROVIDER_SCOPE = "__provider__";

export async function getConnection(
    service: SupabaseClientLike,
    provider: string
): Promise<ProviderConnectionRow | null> {
    const { data } = await service
        .from("provider_connections")
        .select("*")
        .eq("provider", provider)
        .maybeSingle();
    return (data as ProviderConnectionRow | null) ?? null;
}

export async function markConnectionError(service: SupabaseClientLike, provider: string, message: string) {
    await service
        .from("provider_connections")
        .upsert({ provider, status: "error", last_error: message, updated_at: new Date().toISOString() });
}

async function getMeliAccessToken(
    service: SupabaseClientLike,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<{ token: string } | { error: string }> {
    const env = getMeliEnv();
    const secret = getEncryptionSecret();
    const conn = await getConnection(service, "mercadolibre");
    if (!env || !secret || !conn?.access_token_encrypted) return { error: "no connected credentials" };

    if (conn.token_expires_at && Date.parse(conn.token_expires_at) > Date.now() + 60_000) {
        const token = decryptSecret(conn.access_token_encrypted, secret);
        return token ? { token } : { error: "stored credentials unreadable" };
    }

    if (!conn.refresh_token_encrypted) return { error: "credentials expired" };
    const refreshToken = decryptSecret(conn.refresh_token_encrypted, secret);
    if (!refreshToken) return { error: "stored credentials unreadable" };

    const result = await meli.refreshTokens(refreshToken, env, fetchImpl, deadlineMs);
    if (!result.ok || !result.data) {
        await markConnectionError(service, "mercadolibre", "token refresh failed");
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
        .eq("provider", "mercadolibre");

    if (persistError) {
        await markConnectionError(service, "mercadolibre", "credential persistence failed");
        return { error: "credential persistence failed" };
    }

    return { token: result.data.accessToken };
}

async function writeSnapshotSuccess(
    service: SupabaseClientLike,
    source: TrendSource,
    scope: string,
    payload: Record<string, unknown>
) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString();
    await service.from("trend_snapshots").upsert({
        source,
        scope,
        payload,
        fetched_at: now.toISOString(),
        expires_at: expiresAt,
        last_attempt_at: now.toISOString(),
        next_refresh_at: expiresAt,
        error: null,
    }, { onConflict: "source,scope" });
}

async function writeSnapshotError(
    service: SupabaseClientLike,
    source: TrendSource,
    scope: string,
    message: string,
    deferSeconds?: number
) {
    const now = new Date();
    const cooldownMs = deferSeconds ? deferSeconds * 1000 : RETRY_COOLDOWN_MS;
    const nextRefreshAt = new Date(now.getTime() + cooldownMs).toISOString();

    const { data: updated } = await service
        .from("trend_snapshots")
        .update({
            error: message,
            last_attempt_at: now.toISOString(),
            next_refresh_at: nextRefreshAt,
        })
        .eq("source", source)
        .eq("scope", scope)
        .select("source");

    if (!updated || (updated as unknown[]).length === 0) {
        await service.from("trend_snapshots").insert({
            source,
            scope,
            payload: {},
            fetched_at: now.toISOString(),
            expires_at: now.toISOString(),
            last_attempt_at: now.toISOString(),
            next_refresh_at: nextRefreshAt,
            error: message,
        });
    }
}

export async function acquireProviderLease(
    service: SupabaseClientLike,
    source: string,
    owner: string
): Promise<boolean> {
    const { data, error } = await service.rpc("try_acquire_refresh_lease", {
        p_source: source,
        p_scope: PROVIDER_SCOPE,
        p_owner: owner,
        p_ttl_seconds: LEASE_TTL_SECONDS,
    });
    if (error) return false;
    return data === true;
}

export async function releaseProviderLease(service: SupabaseClientLike, source: string, owner: string) {
    await service.rpc("release_refresh_lease", {
        p_source: source,
        p_scope: PROVIDER_SCOPE,
        p_owner: owner,
    });
}

export function sourceConfigured(source: TrendSource, conn: ProviderConnectionRow | null): boolean {
    if (source === "mercadolibre") {
        return !!getMeliEnv() && !!getEncryptionSecret() && !!conn?.access_token_encrypted;
    }
    if (source === "aliexpress_ds") {
        return !!getAliExpressDsEnv() && !!getEncryptionSecret() && !!conn?.access_token_encrypted;
    }
    if (source === "cjdropshipping") {
        return !!getCjApiKey() && !!getEncryptionSecret();
    }
    return !!getAliExpressEnv();
}

async function refreshMeli(
    service: SupabaseClientLike,
    owner: string,
    fetchImpl?: FetchLike
): Promise<string | null> {
    const acquired = await acquireProviderLease(service, "mercadolibre", owner);
    if (!acquired) return null;

    try {
        const deadlineMs = Date.now() + REFRESH_DEADLINE_MS;

        const tokenResult = await getMeliAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) {
            await markConnectionError(service, "mercadolibre", tokenResult.error);
            for (const scope of SCOPES.mercadolibre) {
                await writeSnapshotError(service, "mercadolibre", scope, tokenResult.error);
            }
            return tokenResult.error;
        }

        let firstError: string | null = null;

        if (Date.now() < deadlineMs) {
            const trends = await meli.fetchSearchTrends(tokenResult.token, fetchImpl, deadlineMs);
            if (trends.ok && trends.data) {
                await writeSnapshotSuccess(service, "mercadolibre", "search_keywords", {
                    keywords: trends.data,
                });
            } else {
                const message = trends.error || "trends fetch failed";
                firstError = message;
                await writeSnapshotError(service, "mercadolibre", "search_keywords", message, trends.deferSeconds);
            }
        }

        if (Date.now() < deadlineMs) {
            let categoryIds = getMeliCategoryIds();
            if (categoryIds.length === 0) {
                const categories = await meli.fetchCategories(fetchImpl, deadlineMs);
                if (categories.ok && categories.data) {
                    categoryIds = categories.data.slice(0, 3).map((c) => c.id);
                } else if (categories.error) {
                    firstError = firstError || categories.error;
                }
            }
            if (categoryIds.length === 0) {
                const message = firstError || "no categories discovered";
                await writeSnapshotError(service, "mercadolibre", "best_sellers", message);
            } else {
                const items = await meli.fetchBestSellers(tokenResult.token, categoryIds, fetchImpl, deadlineMs);
                if (items.ok && items.data) {
                    await writeSnapshotSuccess(service, "mercadolibre", "best_sellers", {
                        items: items.data,
                        categoryIds,
                    });
                    if (items.error) firstError = firstError || items.error;
                } else {
                    const message = items.error || "best sellers fetch failed";
                    firstError = firstError || message;
                    await writeSnapshotError(service, "mercadolibre", "best_sellers", message, items.deferSeconds);
                }
            }
        }

        if (firstError) await markConnectionError(service, "mercadolibre", firstError);
        return firstError;
    } finally {
        await releaseProviderLease(service, "mercadolibre", owner);
    }
}

async function refreshAliExpress(
    service: SupabaseClientLike,
    owner: string,
    fetchImpl?: FetchLike
): Promise<string | null> {
    const acquired = await acquireProviderLease(service, "aliexpress", owner);
    if (!acquired) return null;

    try {
        const env = getAliExpressEnv();
        if (!env) return "not configured";

        const { items, error, deferSeconds } = await aliexpress.fetchHotProducts(env, fetchImpl);
        if (error) {
            await writeSnapshotError(service, "aliexpress", "hot_products", error, deferSeconds);
            await markConnectionError(service, "aliexpress", error);
            return error;
        }
        await writeSnapshotSuccess(service, "aliexpress", "hot_products", { items });
        await service
            .from("provider_connections")
            .upsert({ provider: "aliexpress", status: "connected", last_error: null, updated_at: new Date().toISOString() });
        return null;
    } catch (err) {
        const message = err instanceof Error ? err.message : "refresh failed";
        await writeSnapshotError(service, "aliexpress", "hot_products", message);
        await markConnectionError(service, "aliexpress", message);
        return message;
    } finally {
        await releaseProviderLease(service, "aliexpress", owner);
    }
}

export function dsFeedName(conn: ProviderConnectionRow | null): string | null {
    const value = conn?.meta?.ds_feed_name;
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

async function refreshAliExpressDs(
    service: SupabaseClientLike,
    owner: string,
    fetchImpl?: FetchLike,
    conn: ProviderConnectionRow | null = null
): Promise<string | null> {
    const feedName = dsFeedName(conn);
    if (!feedName) return "Selecciona un feed de AliExpress DS.";

    const acquired = await acquireProviderLease(service, "aliexpress_ds", owner);
    if (!acquired) return null;

    try {
        const deadlineMs = Date.now() + Math.min(REFRESH_DEADLINE_MS, LEASE_TTL_SECONDS * 1000 - 5000);
        const dsService = await import("../suppliers/dsService.ts");
        const ds = await import("../suppliers/aliexpressDs.ts");

        // re-read inside the lease: the selection may have changed since the precheck
        const selectedFeed = dsFeedName(await getConnection(service, "aliexpress_ds"));
        if (!selectedFeed) return "Selecciona un feed de AliExpress DS.";

        const tokenResult = await dsService.getDsAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) {
            await markConnectionError(service, "aliexpress_ds", tokenResult.error);
            await writeSnapshotError(service, "aliexpress_ds", "bestseller_feed", tokenResult.error);
            return tokenResult.error;
        }

        const env = getAliExpressDsEnv();
        if (!env) return "not configured";
        const feed = await ds.fetchDsFeedItems(tokenResult.token, env, selectedFeed, fetchImpl, deadlineMs);
        if (!feed.ok || !feed.data) {
            const message = feed.error || "feed fetch failed";
            await writeSnapshotError(service, "aliexpress_ds", "bestseller_feed", message, feed.deferSeconds);
            await markConnectionError(service, "aliexpress_ds", message);
            return message;
        }
        await writeSnapshotSuccess(service, "aliexpress_ds", "bestseller_feed", {
            items: feed.data.items,
        });
        const partial = feed.data.partialError ?? null;
        if (partial) {
            await writeSnapshotError(service, "aliexpress_ds", "bestseller_feed", partial);
            await markConnectionError(service, "aliexpress_ds", partial);
        }
        return partial;
    } catch {
        const message = "refresh failed";
        await writeSnapshotError(service, "aliexpress_ds", "bestseller_feed", message);
        await markConnectionError(service, "aliexpress_ds", message);
        return message;
    } finally {
        await releaseProviderLease(service, "aliexpress_ds", owner);
    }
}

async function refreshCjDropshipping(
    service: SupabaseClientLike,
    owner: string,
    fetchImpl?: FetchLike
): Promise<string | null> {
    const acquired = await acquireProviderLease(service, "cjdropshipping", owner);
    if (!acquired) return null;

    try {
        const deadlineMs = Date.now() + Math.min(REFRESH_DEADLINE_MS, LEASE_TTL_SECONDS * 1000 - 5000);
        const cj = await import("../suppliers/cjdropshipping.ts");

        const tokenResult = await cj.getCjAccessToken(service, fetchImpl, deadlineMs);
        if ("error" in tokenResult) {
            await writeSnapshotError(service, "cjdropshipping", "trending_products", tokenResult.error);
            return tokenResult.error;
        }

        const remaining = deadlineMs - Date.now();
        if (remaining <= 1050) {
            const message = "refresh deadline exceeded";
            await writeSnapshotError(service, "cjdropshipping", "trending_products", message);
            await markConnectionError(service, "cjdropshipping", message);
            return message;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const list = await cj.fetchCjTrendingProducts(tokenResult.token, fetchImpl, deadlineMs);
        if (!list.ok || !list.data) {
            const message = list.error || "product list fetch failed";
            await writeSnapshotError(service, "cjdropshipping", "trending_products", message, list.deferSeconds);
            await markConnectionError(service, "cjdropshipping", message);
            return message;
        }
        await writeSnapshotSuccess(service, "cjdropshipping", "trending_products", {
            items: list.data,
        });
        return null;
    } catch {
        const message = "refresh failed";
        await writeSnapshotError(service, "cjdropshipping", "trending_products", message);
        await markConnectionError(service, "cjdropshipping", message);
        return message;
    } finally {
        await releaseProviderLease(service, "cjdropshipping", owner);
    }
}

async function refreshSource(
    service: SupabaseClientLike,
    source: TrendSource,
    owner: string,
    fetchImpl?: FetchLike
): Promise<string | null> {
    try {
        const conn = await getConnection(service, source);
        if (!sourceConfigured(source, conn)) return "not configured";
        if (source === "mercadolibre") return refreshMeli(service, owner, fetchImpl);
        if (source === "aliexpress_ds") return refreshAliExpressDs(service, owner, fetchImpl, conn);
        if (source === "cjdropshipping") return refreshCjDropshipping(service, owner, fetchImpl);
        return refreshAliExpress(service, owner, fetchImpl);
    } catch {
        const message = "refresh failed";
        for (const scope of SCOPES[source]) {
            try {
                await writeSnapshotError(service, source, scope, message);
            } catch {
                // database unavailable; allSettled callers get the returned error
            }
        }
        return message;
    }
}

async function readSnapshots(service: SupabaseClientLike): Promise<SnapshotRow[]> {
    const { data } = await service.from("trend_snapshots").select("*");
    return (data as SnapshotRow[] | null) ?? [];
}

async function sourceRefreshDue(
    service: SupabaseClientLike,
    source: TrendSource,
    snapshots: SnapshotRow[],
    nowMs: number
): Promise<"unconfigured" | "fresh" | "cooldown" | "due"> {
    const conn = await getConnection(service, source);
    if (!sourceConfigured(source, conn)) return "unconfigured";

    const rows = snapshots.filter((s) => s.source === source);
    if (rows.some((r) => r.next_refresh_at && !refreshDue(r, nowMs))) return "cooldown";
    const allFresh = SCOPES[source].every((scope) =>
        isFresh(rows.find((r) => r.scope === scope)?.fetched_at ?? null, nowMs)
    );
    if (allFresh) return "fresh";
    return "due";
}

export async function getTrends(
    service: SupabaseClientLike,
    options: { autoRefresh?: boolean; fetchImpl?: FetchLike } = {}
): Promise<{ keywords: TrendKeyword[]; items: TrendItem[]; sources: SourceStatus[]; generatedAt: string }> {
    let snapshots = await readSnapshots(service);
    const owner = randomUUID();
    const nowMs = Date.now();

    if (options.autoRefresh !== false) {
        const refreshable: TrendSource[] = [];
        for (const source of SOURCES) {
            const state = await sourceRefreshDue(service, source, snapshots, nowMs);
            if (state === "due") refreshable.push(source);
        }
        if (refreshable.length > 0) {
            await Promise.allSettled(refreshable.map((source) => refreshSource(service, source, owner, options.fetchImpl)));
            snapshots = await readSnapshots(service);
        }
    }

    const connections: Record<string, ProviderConnectionRow | null> = {};
    for (const source of SOURCES) {
        connections[source] = await getConnection(service, source);
    }

    const keywords: TrendKeyword[] = [];
    const items: TrendItem[] = [];
    const sources: SourceStatus[] = [];

    for (const source of SOURCES) {
        const conn = connections[source];
        const configured = sourceConfigured(source, conn);

        const sourceSnapshots = snapshots.filter((s) => s.source === source);
        const freshest = sourceSnapshots.reduce<string | undefined>(
            (acc, s) => (s.fetched_at > (acc || "") ? s.fetched_at : acc),
            undefined
        );
        const hasError = sourceSnapshots.some((s) => s.error);

        for (const snapshot of sourceSnapshots) {
            const payload = snapshot.payload as { keywords?: TrendKeyword[]; items?: TrendItem[] };
            if (Array.isArray(payload.keywords)) keywords.push(...payload.keywords);
            if (Array.isArray(payload.items)) items.push(...payload.items);
        }

        if (!configured) {
            sources.push({
                source,
                status: "disabled",
                message:
                    source === "mercadolibre"
                        ? "Conecta la app de Mercado Libre desde el panel de fuentes."
                        : source === "aliexpress_ds"
                          ? "Conecta la app AliExpress DS desde el panel de fuentes."
                          : source === "cjdropshipping"
                            ? "Configura CJ_API_KEY."
                            : "Configura ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET y ALIEXPRESS_TRACKING_ID.",
            });
        } else if (source === "aliexpress_ds" && !dsFeedName(conn)) {
            sources.push({
                source,
                status: "stale",
                message: "Selecciona un feed de AliExpress DS.",
                feedName: null,
            });
        } else if (hasError) {
            sources.push({
                source,
                status: sourceSnapshots.some((s) => !s.error) ? "stale" : "error",
                message: sourceSnapshots.find((s) => s.error)?.error || undefined,
                fetchedAt: freshest,
                feedName: source === "aliexpress_ds" ? dsFeedName(conn) : undefined,
            });
        } else if (sourceSnapshots.length === 0) {
            sources.push({
                source,
                status: "stale",
                message: "Sin datos todavía.",
                feedName: source === "aliexpress_ds" ? dsFeedName(conn) : undefined,
            });
        } else if (!isFresh(freshest, nowMs)) {
            sources.push({
                source,
                status: "stale",
                fetchedAt: freshest,
                feedName: source === "aliexpress_ds" ? dsFeedName(conn) : undefined,
            });
        } else {
            sources.push({
                source,
                status: "ok",
                fetchedAt: freshest,
                feedName: source === "aliexpress_ds" ? dsFeedName(conn) : undefined,
            });
        }
    }

    return { keywords, items, sources, generatedAt: new Date().toISOString() };
}

export async function refreshTrends(
    service: SupabaseClientLike,
    sources: TrendSource[],
    options: { fetchImpl?: FetchLike } = {}
): Promise<{ refreshed: TrendSource[]; skipped: Record<string, string>; errors: Record<string, string> }> {
    const owner = randomUUID();
    const errors: Record<string, string> = {};
    const skipped: Record<string, string> = {};
    const refreshed: TrendSource[] = [];
    const snapshots = await readSnapshots(service);
    const nowMs = Date.now();

    const valid = sources.filter((s): s is TrendSource => SOURCES.includes(s));
    for (const source of valid) {
        const state = await sourceRefreshDue(service, source, snapshots, nowMs);
        if (state === "unconfigured") {
            skipped[source] = "not configured";
            continue;
        }
        if (state === "cooldown") {
            skipped[source] = "refresh cooldown active";
            continue;
        }
        try {
            const error = await refreshSource(service, source, owner, options.fetchImpl);
            if (error) errors[source] = error;
            else refreshed.push(source);
        } catch (err) {
            errors[source] = err instanceof Error ? err.message : "refresh failed";
        }
    }

    return { refreshed, skipped, errors };
}
