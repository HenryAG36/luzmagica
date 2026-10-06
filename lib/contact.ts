// Client-safe helpers for optional storefront contact/site URLs.
// No hardcoded phone numbers or domains — callers must degrade gracefully
// when the env vars are unset or invalid.

export function supportWhatsAppDigits(): string | null {
    const digits = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
    return digits.length >= 10 ? digits : null;
}

export function buildSupportWhatsAppUrl(message: string): string | null {
    const digits = supportWhatsAppDigits();
    if (!digits) return null;
    const url = new URL(`https://wa.me/${digits}`);
    url.searchParams.set("text", message);
    return url.toString();
}

export function publicSiteOrigin(): string {
    const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
}
