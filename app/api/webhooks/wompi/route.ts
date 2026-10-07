import { NextResponse } from "next/server";
import { getWompiEnv } from "@/lib/env";
import { extractTransaction, verifyEventChecksum, WompiEventBody } from "@/lib/payments/wompi";
import { applyWompiEvent } from "@/lib/orders/repository";
import { sendOrderConfirmationEmail } from "@/lib/email/resend";

// Wompi retries the same event (up to 3x over 24h) until it gets a 200.
// - Invalid checksum -> 401 (never Wompi).
// - Storage/processing failure -> 500 so Wompi retries.
// - Valid signature, any business outcome -> 200 (dedupe handles retries).
export async function POST(request: Request) {
    const env = getWompiEnv();
    if (!env) {
        return NextResponse.json({ error: "not configured" }, { status: 503 });
    }

    let body: WompiEventBody;
    try {
        body = (await request.json()) as WompiEventBody;
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    if (!verifyEventChecksum(body, env.eventsSecret)) {
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    if (body.event !== "transaction.updated") {
        return NextResponse.json({ ok: true, ignored: true });
    }

    const tx = extractTransaction(body);
    if (!tx) {
        return NextResponse.json({ error: "malformed transaction" }, { status: 400 });
    }

    const result = await applyWompiEvent({
        transactionId: tx.id,
        status: tx.status,
        amountInCents: tx.amountInCents,
        paymentLinkId: tx.paymentLinkId,
        checksum: typeof body.signature?.checksum === "string" ? body.signature.checksum : "",
        payload: body.data ?? null,
    });
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Confirmation email fires only on a fresh APPROVED transition. A failed
    // send is logged but never blocks or mutates payment state.
    if (result.paidOrder) {
        const sent = await sendOrderConfirmationEmail(result.paidOrder.order, result.paidOrder.items);
        if (!sent.ok) {
            console.error(`order confirmation email failed (${result.paidOrder.order.ref}): ${sent.error}`);
        }
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
}
