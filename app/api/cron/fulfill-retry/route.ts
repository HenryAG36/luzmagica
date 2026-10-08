import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/env";
import { retryQueuedSupplierOrders } from "@/lib/suppliers/fulfillment";

// Vercel cron sends Authorization: Bearer $CRON_SECRET. Missing secret or
// mismatched token both fail closed.
function authorized(request: Request): boolean {
    const secret = getCronSecret();
    if (!secret) return false;
    return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
    if (!authorized(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: getCronSecret() ? 401 : 503 });
    }
    const result = await retryQueuedSupplierOrders();
    if ("error" in result) {
        return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
}
