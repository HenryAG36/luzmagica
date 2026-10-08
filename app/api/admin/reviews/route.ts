import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { listReviewsForAdmin, moderateReview } from "@/lib/orders/repository";
import { isPlainObject } from "@/lib/catalog/validate";

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);

export async function GET(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const status = new URL(request.url).searchParams.get("status");
    const filter = status && REVIEW_STATUSES.has(status) ? (status as "pending" | "approved" | "rejected") : undefined;
    const result = await listReviewsForAdmin(filter);
    if ("error" in result) {
        return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
}

export async function PATCH(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body) || typeof body.id !== "string" || (body.status !== "approved" && body.status !== "rejected")) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const result = await moderateReview(body.id, body.status);
    if ("error" in result) {
        return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
