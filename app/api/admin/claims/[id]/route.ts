import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { updateClaimAdmin } from "@/lib/orders/claims";
import { CLAIM_STATUS_LABELS } from "@/lib/orders/types";
import { isPlainObject } from "@/lib/catalog/validate";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const { id } = await context.params;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const status =
        typeof body.status === "string" && body.status in CLAIM_STATUS_LABELS
            ? (body.status as keyof typeof CLAIM_STATUS_LABELS)
            : undefined;
    const notes = typeof body.notes === "string" ? body.notes : undefined;
    if (!status && notes === undefined) {
        return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const result = await updateClaimAdmin(id, { status, notes });
    if ("error" in result) {
        return NextResponse.json(result, { status: result.error === "claim not found" ? 404 : 400 });
    }
    return NextResponse.json({ ok: true });
}
