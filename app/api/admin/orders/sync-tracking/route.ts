import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { syncDueOrders } from "@/lib/suppliers/tracking";

// Bulk on-demand sweep — the panel calls this on mount. Per-order throttling
// inside syncOrderTracking keeps provider traffic bounded.
export async function POST() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const result = await syncDueOrders();
    if ("error" in result) {
        return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
}
