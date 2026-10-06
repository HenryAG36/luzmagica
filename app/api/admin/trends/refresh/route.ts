import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { refreshTrends, getTrends } from "@/lib/trends/service";
import type { TrendSource } from "@/lib/trends/types";

const VALID_SOURCES = new Set<TrendSource>(["mercadolibre", "aliexpress"]);

export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    let requested: TrendSource[] = ["mercadolibre", "aliexpress"];
    try {
        const body = await request.json();
        if (Array.isArray(body?.sources)) {
            requested = body.sources.filter((s: unknown): s is TrendSource =>
                typeof s === "string" && VALID_SOURCES.has(s as TrendSource)
            );
        }
    } catch {
    }

    const { refreshed, skipped, errors } = await refreshTrends(service, requested);
    const payload = await getTrends(service, { autoRefresh: false });

    return NextResponse.json({ ...payload, refreshed, skipped, errors });
}
