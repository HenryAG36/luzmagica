import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getAttentionQueue, getOrderSummary, listOrdersForAdmin } from "@/lib/orders/repository";

const PAGE_MAX = 50;
const VALID_FILTERS = new Set([
    "pending_payment",
    "paid",
    "payment_failed",
    "payment_review",
    "cancelled",
    "refunded",
]);

function boundedInt(raw: string | null, fallback: number, max: number): number {
    const value = raw === null ? Number.NaN : Number(raw);
    if (!Number.isInteger(value) || value < 0) return fallback;
    return Math.min(value, max);
}

export async function GET(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const params = new URL(request.url).searchParams;
    if (params.get("summary") === "1") {
        const summary = await getOrderSummary();
        if ("error" in summary) {
            return NextResponse.json({ error: summary.error }, { status: 502 });
        }
        return NextResponse.json({ summary });
    }

    if (params.get("attention") === "1") {
        const attention = await getAttentionQueue();
        if ("error" in attention) {
            return NextResponse.json({ error: attention.error }, { status: 502 });
        }
        return NextResponse.json({ attention });
    }

    const statusParam = params.get("status");
    const paymentStatus = statusParam && VALID_FILTERS.has(statusParam) ? statusParam : undefined;
    const limit = boundedInt(params.get("limit"), PAGE_MAX, PAGE_MAX);
    const offset = boundedInt(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);

    const result = await listOrdersForAdmin({ paymentStatus, limit, offset });
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ orders: result.orders, limit, offset });
}
