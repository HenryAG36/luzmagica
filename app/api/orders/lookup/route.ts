import { NextResponse } from "next/server";
import { sanitizeOrderLookup } from "@/lib/orders/validate";
import { lookupForGuest } from "@/lib/orders/repository";

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const parsed = sanitizeOrderLookup(body);
    if (!parsed) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const order = await lookupForGuest(parsed.ref, parsed.contact);
    if (!order) {
        // Same response whether the ref is wrong or the contact is — no
        // enumeration of which part failed.
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ order });
}
