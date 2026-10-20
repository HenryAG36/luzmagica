import { NextResponse } from "next/server";

// Same-origin guard for state-changing admin endpoints. Requests without an
// Origin header (server-to-server, curl) are allowed; a present foreign origin
// is rejected.
export function checkAdminOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get("origin");
    if (!origin) return null;
    try {
        if (new URL(origin).origin !== new URL(request.url).origin) {
            return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
    return null;
}

// Admin API responses contain privileged data and must never be cached.
export function adminJson(body: unknown, init?: ResponseInit): NextResponse {
    return NextResponse.json(body, {
        ...init,
        headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
    });
}
