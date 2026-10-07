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

export interface AliExpressDsEnv {
    appKey: string;
    appSecret: string;
    redirectUri: string;
}

export function getAliExpressDsEnv(): AliExpressDsEnv | null {
    const appKey = process.env.ALIEXPRESS_DS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_DS_APP_SECRET;
    const redirectUri = process.env.ALIEXPRESS_DS_REDIRECT_URI;
    if (!appKey || !appSecret || !redirectUri) return null;
    try {
        const url = new URL(redirectUri);
        if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
            return null;
        }
    } catch {
        return null;
    }
    return { appKey, appSecret, redirectUri };
}

export function getCjApiKey(): string | null {
    return process.env.CJ_API_KEY || null;
}

export interface WompiEnv {
    privateKey: string;
    eventsSecret: string;
    environment: "sandbox" | "production";
    baseUrl: string;
}

// Wompi is only "configured" when both the private key and the events
// (webhook) secret exist — checkout without signature verification would
// leave orders permanently unconfirmed. WOMPI_ENVIRONMENT defaults to
// sandbox so an explicit flag is required to accept real charges.
export function getWompiEnv(): WompiEnv | null {
    const privateKey = process.env.WOMPI_PRIVATE_KEY;
    const eventsSecret = process.env.WOMPI_EVENTS_SECRET;
    if (!privateKey || !eventsSecret) return null;
    const environment = process.env.WOMPI_ENVIRONMENT === "production" ? "production" : "sandbox";
    return {
        privateKey,
        eventsSecret,
        environment,
        baseUrl:
            environment === "production"
                ? "https://production.wompi.co/v1"
                : "https://sandbox.wompi.co/v1",
    };
}

export interface ResendEnv {
    apiKey: string;
    from: string;
}

// Confirmation email is optional: without it orders still work, the customer
// just relies on the tracking page.
export function getResendEnv(): ResendEnv | null {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return null;
    return { apiKey, from };
}

export function getMeliCategoryIds(): string[] {
    const raw = process.env.MELI_CATEGORY_IDS || "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
}
