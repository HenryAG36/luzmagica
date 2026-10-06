import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { listDsFeeds, selectDsFeed } from "@/lib/suppliers/dsService";
import { isPlainObject } from "@/lib/catalog/validate";

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const result = await listDsFeeds(service);
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ feeds: result.feeds, selectedFeed: result.selectedFeed });
}

export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (
        !isPlainObject(body) ||
        typeof body.feedName !== "string" ||
        body.feedName.trim() === "" ||
        body.feedName.length > 200
    ) {
        return NextResponse.json({ error: "invalid feed name" }, { status: 400 });
    }

    const result = await selectDsFeed(service, body.feedName);
    if ("error" in result) {
        const status = result.error === "unknown feed" ? 400 : 502;
        return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ selectedFeed: result.selectedFeed });
}
