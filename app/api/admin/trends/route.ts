import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getTrends } from "@/lib/trends/service";

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const payload = await getTrends(service, { autoRefresh: true });
    return NextResponse.json(payload);
}
