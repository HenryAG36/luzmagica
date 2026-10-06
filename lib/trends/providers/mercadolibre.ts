import { createHash, randomBytes } from "crypto";
import { fetchJson } from "../http.ts";
import type { FetchLike } from "../http.ts";
import type { TrendItem, TrendKeyword } from "../types.ts";

const API_BASE = "https://api.mercadolibre.com";
const AUTH_BASE = "https://auth.mercadolibre.com.co";
const SITE_ID = "MCO";
const MAX_CATEGORIES = 3;
const MAX_DETAIL_IDS = 20;
const MAX_SINGLE_DETAILS = 8;

export interface MeliTokenSet {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
}

export interface ProviderResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
    deferSeconds?: number;
}

interface MeliTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
}

export function generateOAuthState(): string {
    return randomBytes(24).toString("base64url");
}

export function generatePkceVerifier(): string {
    return randomBytes(48).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
}): string {
    const url = new URL(`${AUTH_BASE}/authorization`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("state", params.state);
    if (params.codeChallenge) {
        url.searchParams.set("code_challenge", params.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
}

function normalizeTokenResponse(data: MeliTokenResponse | undefined): MeliTokenSet | null {
    if (!data?.access_token) return null;
    const expiresAt =
        typeof data.expires_in === "number"
            ? new Date(Date.now() + data.expires_in * 1000).toISOString()
            : null;
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt,
    };
}

export async function exchangeCodeForTokens(
    code: string,
    config: { clientId: string; clientSecret: string; redirectUri: string },
    codeVerifier?: string,
    fetchImpl?: FetchLike
): Promise<ProviderResult<MeliTokenSet>> {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);

    const res = await fetchJson<MeliTokenResponse>(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
    }, { fetchImpl });

    const tokens = res.ok ? normalizeTokenResponse(res.data) : null;
    if (!tokens) return { ok: false, error: res.error || "token exchange rejected" };
    return { ok: true, data: tokens };
}

export async function refreshTokens(
    refreshToken: string,
    config: { clientId: string; clientSecret: string },
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<MeliTokenSet>> {
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
    });

    const res = await fetchJson<MeliTokenResponse>(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
    }, { fetchImpl, deadlineMs });

    const tokens = res.ok ? normalizeTokenResponse(res.data) : null;
    if (!tokens) return { ok: false, error: res.error || "token refresh rejected", deferSeconds: res.deferSeconds };
    return { ok: true, data: tokens };
}

export function normalizeTrendKeywords(raw: unknown): TrendKeyword[] {
    if (!Array.isArray(raw)) return [];
    const out: TrendKeyword[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const keyword = (entry as Record<string, unknown>).keyword;
        const url = (entry as Record<string, unknown>).url;
        if (typeof keyword !== "string" || typeof url !== "string") continue;
        out.push({ keyword, url, source: "mercadolibre", signalType: "search_keyword" });
    }
    return out;
}

export interface CategorySummary {
    id: string;
    name: string;
}

export function normalizeCategories(raw: unknown): CategorySummary[] {
    if (!Array.isArray(raw)) return [];
    const out: CategorySummary[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const id = (entry as Record<string, unknown>).id;
        const name = (entry as Record<string, unknown>).name;
        if (typeof id === "string" && typeof name === "string") {
            out.push({ id, name });
        }
    }
    return out;
}

export type HighlightDetailType = "ITEM" | "PRODUCT" | "USER_PRODUCT";

export interface HighlightEntry {
    id: string;
    type: HighlightDetailType;
    position: number | null;
}

export function normalizeHighlightEntries(raw: unknown): HighlightEntry[] {
    if (typeof raw !== "object" || raw === null) return [];
    const content = (raw as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    const out: HighlightEntry[] = [];
    for (const entry of content) {
        if (typeof entry !== "object" || entry === null) continue;
        const rec = entry as Record<string, unknown>;
        const id = rec.id;
        const type = rec.type;
        if (typeof id !== "string") continue;
        if (type !== "ITEM" && type !== "PRODUCT" && type !== "USER_PRODUCT") continue;
        out.push({
            id,
            type,
            position: typeof rec.position === "number" ? rec.position : null,
        });
    }
    return out;
}

export function partitionHighlightIds(entries: HighlightEntry[]): Record<HighlightDetailType, string[]> {
    const grouped: Record<HighlightDetailType, string[]> = { ITEM: [], PRODUCT: [], USER_PRODUCT: [] };
    for (const entry of entries.slice(0, MAX_DETAIL_IDS)) {
        grouped[entry.type].push(entry.id);
    }
    return grouped;
}

interface MeliItemBody {
    id?: string;
    title?: string;
    price?: number;
    currency_id?: string;
    thumbnail?: string;
    permalink?: string;
    sold_quantity?: number;
    category_id?: string;
}

interface MeliProductBody {
    id?: string;
    name?: string;
    pictures?: { url?: string }[];
    thumbnail?: string;
    permalink?: string;
    short_description?: { content?: string };
    domain_id?: string;
}

interface MeliUserProductBody {
    id?: string;
    name?: string;
    family_name?: string;
    thumbnail?: string;
    pictures?: { url?: string }[];
    domain_id?: string;
}

function toTrendItem(
    sourceId: string,
    title: string | undefined,
    image: string | null,
    price: number | null,
    currency: string | null,
    rank: number | null,
    url: string | null,
    category: string | null
): TrendItem {
    return {
        id: `meli-${sourceId}`,
        source: "mercadolibre",
        sourceId,
        signalType: "best_seller_rank",
        title: title || sourceId,
        image,
        price,
        currency,
        rank,
        salesVolume: null,
        url,
        category,
    };
}

export function normalizeItemBodies(raw: unknown, rankById: Map<string, number>): TrendItem[] {
    if (!Array.isArray(raw)) return [];
    const out: TrendItem[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const wrapper = entry as Record<string, unknown>;
        const body = (wrapper.body ?? wrapper) as MeliItemBody;
        if (typeof body !== "object" || body === null || typeof body.id !== "string") continue;
        out.push(
            toTrendItem(
                body.id,
                typeof body.title === "string" ? body.title : undefined,
                typeof body.thumbnail === "string" ? body.thumbnail : null,
                typeof body.price === "number" ? body.price : null,
                typeof body.currency_id === "string" ? body.currency_id : null,
                rankById.get(body.id) ?? null,
                typeof body.permalink === "string" ? body.permalink : null,
                typeof body.category_id === "string" ? body.category_id : null
            )
        );
        const item = out[out.length - 1];
        if (typeof body.sold_quantity === "number") item.salesVolume = body.sold_quantity;
    }
    return out;
}

export function normalizeProductBody(raw: unknown, rank: number | null): TrendItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as MeliProductBody;
    if (typeof body.id !== "string") return null;
    const picture = Array.isArray(body.pictures)
        ? body.pictures.find((p) => typeof p?.url === "string")?.url ?? null
        : typeof body.thumbnail === "string"
            ? body.thumbnail
            : null;
    return toTrendItem(
        body.id,
        typeof body.name === "string" ? body.name : undefined,
        picture,
        null,
        null,
        rank,
        typeof body.permalink === "string" ? body.permalink : null,
        typeof body.domain_id === "string" ? body.domain_id : null
    );
}

export function normalizeUserProductBody(raw: unknown, rank: number | null): TrendItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as MeliUserProductBody;
    if (typeof body.id !== "string") return null;
    const picture = Array.isArray(body.pictures)
        ? body.pictures.find((p) => typeof p?.url === "string")?.url ?? null
        : typeof body.thumbnail === "string"
            ? body.thumbnail
            : null;
    return toTrendItem(
        body.id,
        typeof body.name === "string" ? body.name : typeof body.family_name === "string" ? body.family_name : undefined,
        picture,
        null,
        null,
        rank,
        null,
        typeof body.domain_id === "string" ? body.domain_id : null
    );
}

export async function fetchCategories(
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<CategorySummary[]>> {
    const res = await fetchJson<unknown>(`${API_BASE}/sites/${SITE_ID}/categories`, {}, { fetchImpl, deadlineMs });
    if (!res.ok) return { ok: false, error: res.error || `http ${res.status}`, deferSeconds: res.deferSeconds };
    return { ok: true, data: normalizeCategories(res.data) };
}

export async function fetchSearchTrends(
    accessToken: string,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<TrendKeyword[]>> {
    const res = await fetchJson<unknown>(`${API_BASE}/trends/${SITE_ID}`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    }, { fetchImpl, deadlineMs });
    if (!res.ok) return { ok: false, error: `trends: ${res.error || `http ${res.status}`}`, deferSeconds: res.deferSeconds };
    return { ok: true, data: normalizeTrendKeywords(res.data) };
}

async function fetchItemDetails(
    accessToken: string,
    ids: string[],
    rankById: Map<string, number>,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<TrendItem[]>> {
    const res = await fetchJson<unknown>(
        `${API_BASE}/items?ids=${encodeURIComponent(ids.join(","))}`,
        { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
        { fetchImpl, deadlineMs }
    );
    if (!res.ok) return { ok: false, error: `items: ${res.error || `http ${res.status}`}`, deferSeconds: res.deferSeconds };
    return { ok: true, data: normalizeItemBodies(res.data, rankById) };
}

async function fetchSingleDetails(
    accessToken: string,
    path: "products" | "user-products",
    ids: string[],
    rankById: Map<string, number>,
    normalizer: (raw: unknown, rank: number | null) => TrendItem | null,
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<TrendItem[]>> {
    const items: TrendItem[] = [];
    for (const id of ids.slice(0, MAX_SINGLE_DETAILS)) {
        if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
            return { ok: items.length > 0, data: items, error: "refresh deadline reached" };
        }
        const res = await fetchJson<unknown>(
            `${API_BASE}/${path}/${encodeURIComponent(id)}`,
            { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
            { fetchImpl, deadlineMs }
        );
        if (!res.ok) {
            if (res.status === 404) continue;
            return { ok: items.length > 0, data: items, error: `${path}: ${res.error || `http ${res.status}`}`, deferSeconds: res.deferSeconds };
        }
        const item = normalizer(res.data, rankById.get(id) ?? null);
        if (item) items.push(item);
    }
    return { ok: true, data: items };
}

export async function fetchBestSellers(
    accessToken: string,
    categoryIds: string[],
    fetchImpl?: FetchLike,
    deadlineMs?: number
): Promise<ProviderResult<TrendItem[]>> {
    const items: TrendItem[] = [];
    const errors: string[] = [];

    for (const categoryId of categoryIds.slice(0, MAX_CATEGORIES)) {
        if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
            errors.push("refresh deadline reached");
            break;
        }
        const highlights = await fetchJson<unknown>(
            `${API_BASE}/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`,
            { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
            { fetchImpl, deadlineMs }
        );
        if (!highlights.ok) {
            errors.push(`highlights/${categoryId}: ${highlights.error || `http ${highlights.status}`}`);
            continue;
        }

        const entries = normalizeHighlightEntries(highlights.data);
        const rankById = new Map<string, number>();
        entries.forEach((e) => {
            if (e.position !== null) rankById.set(e.id, e.position);
        });
        const grouped = partitionHighlightIds(entries);

        if (grouped.ITEM.length > 0) {
            const details = await fetchItemDetails(accessToken, grouped.ITEM, rankById, fetchImpl, deadlineMs);
            if (details.data) items.push(...details.data);
            if (details.error) errors.push(details.error);
        }
        if (grouped.PRODUCT.length > 0) {
            const details = await fetchSingleDetails(
                accessToken, "products", grouped.PRODUCT, rankById, normalizeProductBody, fetchImpl, deadlineMs
            );
            if (details.data) items.push(...details.data);
            if (details.error) errors.push(details.error);
        }
        if (grouped.USER_PRODUCT.length > 0) {
            const details = await fetchSingleDetails(
                accessToken, "user-products", grouped.USER_PRODUCT, rankById, normalizeUserProductBody, fetchImpl, deadlineMs
            );
            if (details.data) items.push(...details.data);
            if (details.error) errors.push(details.error);
        }
    }

    if (items.length === 0 && errors.length > 0) {
        return { ok: false, error: errors.join("; ") };
    }
    return { ok: true, data: items, error: errors.length ? errors.join("; ") : undefined };
}
