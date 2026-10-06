import { NextRequest, NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getEncryptionSecret, getMeliEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/crypto";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/trends/providers/mercadolibre";

export async function GET(request: NextRequest) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const env = getMeliEnv();
    const secret = getEncryptionSecret();
    const service = getServiceRoleClient();
    if (!env || !secret || !service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expectedState = request.cookies.get("meli_oauth_state")?.value;
    const verifier = request.cookies.get("meli_oauth_verifier")?.value;

    const redirectBase = new URL("/operator", request.url);
    redirectBase.searchParams.set("tab", "trends");

    if (!code || !state || !expectedState || state !== expectedState) {
        redirectBase.searchParams.set("meli", "invalid_state");
        return NextResponse.redirect(redirectBase);
    }

    const tokens = await exchangeCodeForTokens(code, env, verifier || undefined);
    if (!tokens.ok || !tokens.data) {
        redirectBase.searchParams.set("meli", "exchange_failed");
        return NextResponse.redirect(redirectBase);
    }

    const { error } = await service.from("provider_connections").upsert({
        provider: "mercadolibre",
        status: "connected",
        access_token_encrypted: encryptSecret(tokens.data.accessToken, secret),
        refresh_token_encrypted: tokens.data.refreshToken ? encryptSecret(tokens.data.refreshToken, secret) : null,
        token_expires_at: tokens.data.expiresAt,
        connected_by: auth.user.id,
        last_error: null,
        updated_at: new Date().toISOString(),
    });

    const response = NextResponse.redirect(redirectBase);
    response.cookies.delete("meli_oauth_state");
    response.cookies.delete("meli_oauth_verifier");
    if (error) {
        return NextResponse.json({ error: "failed to persist connection" }, { status: 500 });
    }
    return response;
}
