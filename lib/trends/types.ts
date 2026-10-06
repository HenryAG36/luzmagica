export type TrendSource = "mercadolibre" | "aliexpress" | "aliexpress_ds" | "cjdropshipping";

export type SignalType = "search_keyword" | "best_seller_rank" | "hot_product" | "supplier_feed" | "supplier_trending";

export interface TrendKeyword {
    keyword: string;
    url: string;
    source: TrendSource;
    signalType: "search_keyword";
}

export interface TrendItem {
    id: string;
    source: TrendSource;
    sourceId: string;
    signalType: SignalType;
    title: string;
    image: string | null;
    price: number | null;
    currency: string | null;
    rank: number | null;
    salesVolume: number | null;
    listingCount?: number | null;
    url: string | null;
    category: string | null;
}

export interface SourceStatus {
    source: TrendSource;
    status: "ok" | "disabled" | "error" | "stale";
    message?: string;
    fetchedAt?: string;
    expiresAt?: string;
}

export interface TrendsPayload {
    keywords: TrendKeyword[];
    items: TrendItem[];
    sources: SourceStatus[];
    generatedAt: string;
}

export interface ProviderConnectionRow {
    provider: TrendSource;
    status: "connected" | "disconnected" | "error";
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    token_expires_at: string | null;
    meta: Record<string, unknown>;
    last_error: string | null;
    updated_at: string;
}

export interface SnapshotRow {
    source: string;
    scope: string;
    payload: Record<string, unknown>;
    fetched_at: string;
    expires_at: string;
    last_attempt_at: string | null;
    next_refresh_at: string | null;
    error: string | null;
}
