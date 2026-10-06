import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getAliExpressDsEnv } from "@/lib/env";
import { buildAuthorizationUrl, generateOAuthState, packStateCookie } from "@/lib/suppliers/aliexpressDs";

const COOKIE_MAX_AGE = 600;

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const env = getAliExpressDsEnv();
    if (!env) {
        return NextResponse.json({ error: "aliexpress ds not configured" }, { status: 503 });
    }

    const state = generateOAuthState();
    const url = buildAuthorizationUrl(env, state);

    const response = NextResponse.redirect(url);
    response.cookies.set("ae_ds_oauth_state", packStateCookie(state, auth.user.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE,
        path: "/",
    });
    return response;
}
