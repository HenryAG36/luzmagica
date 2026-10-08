import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { listClaimsForAdmin } from "@/lib/orders/claims";
import { CLAIM_STATUS_LABELS } from "@/lib/orders/types";

export async function GET(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const statusParam = new URL(request.url).searchParams.get("status");
    const status =
        statusParam && statusParam in CLAIM_STATUS_LABELS
            ? (statusParam as keyof typeof CLAIM_STATUS_LABELS)
            : undefined;
    const result = await listClaimsForAdmin(status);
    if ("error" in result) {
        return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
}
