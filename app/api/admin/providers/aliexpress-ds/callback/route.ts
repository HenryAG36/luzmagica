import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getAliExpressDsEnv, getEncryptionSecret } from "@/lib/env";
import { encryptSecret } from "@/lib/crypto";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, validateDsCallback } from "@/lib/suppliers/aliexpressDs";
import { DS_PROVIDER } from "@/lib/suppliers/dsService";
import { acquireProviderLease, releaseProviderLease } from "@/lib/trends/service";

export async function GET(request: NextRequest) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const env = getAliExpressDsEnv();
    const secret = getEncryptionSecret();
    const service = getServiceRoleClient();
    if (!env || !secret || !service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const redirectBase = new URL("/operator", request.url);
    redirectBase.searchParams.set("tab", "trends");

    const finish = (result: string) => {
        redirectBase.searchParams.set("ae_ds", result);
        const response = NextResponse.redirect(redirectBase);
        response.cookies.delete("ae_ds_oauth_state");
        return response;
    };

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const cookieValue = request.cookies.get("ae_ds_oauth_state")?.value;

    const verdict = validateDsCallback(cookieValue, state, auth.user.id);
    if (!verdict.ok) {
        return finish(verdict.reason);
    }
    if (!code || code.length > 256) {
        return finish("invalid_code");
    }

    const owner = randomUUID();
    const acquired = await acquireProviderLease(service, DS_PROVIDER, owner);
    if (!acquired) {
        return finish("connection_busy");
    }

    try {
        const tokens = await exchangeCodeForTokens(code, env);
        if (!tokens.ok || !tokens.data) {
            return finish("exchange_failed");
        }

        const { error } = await service.from("provider_connections").upsert({
            provider: DS_PROVIDER,
            status: "connected",
            access_token_encrypted: encryptSecret(tokens.data.accessToken, secret),
            refresh_token_encrypted: tokens.data.refreshToken
                ? encryptSecret(tokens.data.refreshToken, secret)
                : null,
            token_expires_at: tokens.data.expiresAt,
            connected_by: auth.user.id,
            last_error: null,
            updated_at: new Date().toISOString(),
        });
        if (error) {
            return finish("persist_failed");
        }
        return finish("connected");
    } finally {
        await releaseProviderLease(service, DS_PROVIDER, owner);
    }
}
