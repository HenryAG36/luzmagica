import { NextResponse } from "next/server";
import { sanitizeOrderInput } from "@/lib/orders/validate";
import { priceOrder } from "@/lib/orders/pricing";
import { attachPaymentLink, createPendingOrder } from "@/lib/orders/repository";
import { createPaymentLink } from "@/lib/payments/wompi";
import { getWompiEnv } from "@/lib/env";
import { publicSiteOrigin } from "@/lib/contact";

const LINK_TTL_MS = 2 * 60 * 60 * 1000;

export async function POST(request: Request) {
    const env = getWompiEnv();
    if (!env) {
        return NextResponse.json(
            { error: "Los pagos aún no están disponibles." },
            { status: 503 }
        );
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const parsed = sanitizeOrderInput(body);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const priced = await priceOrder(parsed.input.items, parsed.input.couponCode);
    if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: 400 });
    }

    const created = await createPendingOrder(
        parsed.input.customer,
        priced.pricing,
        new Date().toISOString()
    );
    if ("error" in created) {
        return NextResponse.json({ error: created.error }, { status: 502 });
    }

    const order = created.order;
    const origin = publicSiteOrigin() || new URL(request.url).origin;
    const redirectUrl = `${origin}/checkout/confirmacion?ref=${encodeURIComponent(order.ref)}&t=${order.lookup_token}`;

    if (!order.payment_link_url) {
        const itemsSummary = priced.pricing.items
            .map((i) => `${i.name} x${i.quantity}`)
            .join(", ");
        const link = await createPaymentLink({
            name: `Pedido ${order.ref} — LuzMágica`,
            description: `Productos: ${itemsSummary}`,
            amountInCents: order.total_cop * 100,
            redirectUrl,
            expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString(),
        });
        if (!link.ok) {
            return NextResponse.json(
                { error: "No se pudo iniciar el pago; intenta de nuevo en unos minutos.", ref: order.ref },
                { status: 502 }
            );
        }
        const attached = await attachPaymentLink(order.id, link.link);
        if ("error" in attached) {
            return NextResponse.json({ error: attached.error }, { status: 502 });
        }
        order.payment_link_url = link.link.url;
    }

    return NextResponse.json(
        {
            ref: order.ref,
            orderAccess: order.lookup_token,
            checkoutUrl: order.payment_link_url,
        },
        { status: created.reused ? 200 : 201 }
    );
}
