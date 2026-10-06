export interface SupabasePublicEnv {
    url: string;
    anonKey: string;
}

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    try {
        new URL(url);
    } catch {
        return null;
    }
    return { url, anonKey };
}

export function getServiceRoleKey(): string | null {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function getEncryptionSecret(): string | null {
    return process.env.PROVIDER_TOKEN_ENCRYPTION_KEY || null;
}

export interface MeliEnv {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export function getMeliEnv(): MeliEnv | null {
    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;
    const redirectUri = process.env.MELI_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
}

export interface AliExpressEnv {
    appKey: string;
    appSecret: string;
    trackingId: string;
}

export function getAliExpressEnv(): AliExpressEnv | null {
    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;
    const trackingId = process.env.ALIEXPRESS_TRACKING_ID;
    if (!appKey || !appSecret || !trackingId) return null;
    return { appKey, appSecret, trackingId };
}

export function getMeliCategoryIds(): string[] {
    const raw = process.env.MELI_CATEGORY_IDS || "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
}
