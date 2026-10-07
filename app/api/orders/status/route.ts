import { NextResponse } from "next/server";
import { sanitizeOrderStatusQuery } from "@/lib/orders/validate";
import { lookupByToken } from "@/lib/orders/repository";

// Confirmation-page polling: requires the unguessable lookup token issued
// at order creation (embedded in the Wompi redirect URL).
export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const parsed = sanitizeOrderStatusQuery(body);
    if (!parsed) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const order = await lookupByToken(parsed.ref, parsed.token);
    if (!order) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ order });
}
