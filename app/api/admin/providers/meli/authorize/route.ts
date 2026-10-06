import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getMeliEnv } from "@/lib/env";
import {
    buildAuthorizationUrl,
    generateOAuthState,
    generatePkceVerifier,
    pkceChallenge,
} from "@/lib/trends/providers/mercadolibre";

const COOKIE_MAX_AGE = 600;

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const env = getMeliEnv();
    if (!env) {
        return NextResponse.json({ error: "mercadolibre not configured" }, { status: 503 });
    }

    const state = generateOAuthState();
    const verifier = generatePkceVerifier();
    const url = buildAuthorizationUrl({
        clientId: env.clientId,
        redirectUri: env.redirectUri,
        state,
        codeChallenge: pkceChallenge(verifier),
    });

    const response = NextResponse.redirect(url);
    const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
    };
    response.cookies.set("meli_oauth_state", state, cookieOpts);
    response.cookies.set("meli_oauth_verifier", verifier, cookieOpts);
    return response;
}
