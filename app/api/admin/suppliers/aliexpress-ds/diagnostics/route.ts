import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { runDsDiagnostics } from "@/lib/suppliers/dsDiagnostics";

export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const origin = request.headers.get("origin");
    if (origin) {
        try {
            if (new URL(origin).origin !== new URL(request.url).origin) {
                return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
            }
        } catch {
            return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
        }
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    try {
        const result = await runDsDiagnostics(service);
        if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 502 });
        }
        return NextResponse.json({ diagnostics: result.report });
    } catch {
        return NextResponse.json({ error: "diagnostic failed" }, { status: 502 });
    }
}
