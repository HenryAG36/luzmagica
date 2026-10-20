import { NextResponse } from "next/server";
import { sanitizeOrderInput, type SanitizedOrderInput } from "@/lib/orders/validate";
import { priceOrder } from "@/lib/orders/pricing";
import { attachPaymentLink, createPendingOrder } from "@/lib/orders/repository";
import { createCodOrder, findExistingCodOrder } from "@/lib/orders/cod";
import {
    validateMastershopCodItems,
    validateMastershopCodCustomer,
    placeMastershopCodOrder,
} from "@/lib/suppliers/mastershopOrders";
import { createPaymentLink } from "@/lib/payments/wompi";
import { getWompiEnv, isMastershopCodEnabled } from "@/lib/env";
import { publicSiteOrigin } from "@/lib/contact";
import { getVerifiedUser } from "@/lib/auth/server";
import { getLoyaltyBalance, POINT_VALUE_COP } from "@/lib/loyalty/service";
import { isPlainObject } from "@/lib/catalog/validate";
import { checkAdminOrigin } from "@/lib/api/guards";
import type { OrderRow } from "@/lib/orders/types";

// Live COD pre-submit validation can take several provider reads; keep the
// whole request inside the platform's max duration.
export const maxDuration = 300;

const LINK_TTL_MS = 2 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CodRouteInput extends SanitizedOrderInput {
    checkoutAttemptId?: unknown;
    pointsToRedeem?: unknown;
}

function confirmationResponse(request: Request, order: OrderRow, status: number) {
    const origin = publicSiteOrigin() || new URL(request.url).origin;
    return NextResponse.json(
        {
            ref: order.ref,
            orderAccess: order.lookup_token,
            checkoutUrl: `${origin}/checkout/confirmacion?ref=${encodeURIComponent(order.ref)}&t=${order.lookup_token}`,
            supplierSubmitted: order.supplier_order_status === "submitted",
        },
        { status }
    );
}

async function handleCodCheckout(request: Request, input: CodRouteInput): Promise<NextResponse> {
    // Same-origin guard: the COD form posts from our own checkout page.
    const forbidden = checkAdminOrigin(request);
    if (forbidden) return forbidden;

    const checkoutAttemptId =
        typeof input.checkoutAttemptId === "string" ? input.checkoutAttemptId : "";
    if (!UUID_PATTERN.test(checkoutAttemptId)) {
        return NextResponse.json({ error: "Solicitud de checkout inválida." }, { status: 400 });
    }

    if (input.couponCode || (typeof input.pointsToRedeem === "number" && input.pointsToRedeem > 0)) {
        return NextResponse.json(
            { error: "Cupones y puntos disponibles con pago en línea." },
            { status: 400 }
        );
    }

    const customerError = validateMastershopCodCustomer(input.customer);
    if (customerError) {
        return NextResponse.json({ error: customerError }, { status: 400 });
    }

    // Lost-response recovery BEFORE pricing/provider work: if this attempt
    // already created an order, return its original confirmation — provider
    // stock/price may have changed since and must not block the retry. This
    // works even if the feature flag was turned off meanwhile. A different
    // customer/cart reusing the same attempt id is a conflict that reveals
    // nothing about the stored order.
    const existing = await findExistingCodOrder(input.customer, input.items, checkoutAttemptId);
    if ("error" in existing) {
        const conflict = existing.error.includes("cambió");
        return NextResponse.json({ error: existing.error }, { status: conflict ? 409 : 502 });
    }
    if (existing.order) {
        // Submission/reconciliation continues via cron and operator controls.
        return confirmationResponse(request, existing.order, 200);
    }

    if (!isMastershopCodEnabled()) {
        return NextResponse.json(
            { error: "La contraentrega no está disponible en este momento." },
            { status: 403 }
        );
    }

    const priced = await priceOrder(input.items, null, undefined, input.customer.city);
    if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: 400 });
    }
    const pricing = priced.pricing;

    if (pricing.items.some((i) => i.source !== "mastershop")) {
        return NextResponse.json(
            { error: "Contraentrega solo está disponible para pedidos 100% Mastershop." },
            { status: 400 }
        );
    }
    if (pricing.discountCop > 0) {
        return NextResponse.json(
            { error: "Cupones y puntos disponibles con pago en línea." },
            { status: 400 }
        );
    }

    // Live provider validation: account membership, current variant/stock,
    // COP price and the operator-registered weight — before any local write.
    const validation = await validateMastershopCodItems(
        pricing.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit_price_cop: i.unitPriceCop,
            unit_shipping_cop: i.unitShippingCop,
            source: i.source,
            supplier_variant: i.supplierVariant,
        }))
    );
    if ("error" in validation) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const created = await createCodOrder(
        input.customer,
        pricing,
        new Date().toISOString(),
        checkoutAttemptId
    );
    if ("error" in created) {
        return NextResponse.json({ error: created.error }, { status: 502 });
    }

    const order = created.order;

    // Provider submission is best-effort AFTER the local order exists: a
    // remote failure must still return the confirmation — the operator sees
    // the order in the attention/reconciliation queue. Fresh attempts only;
    // a reused order never re-submits (place* is itself idempotent).
    let supplierSubmitted = order.supplier_order_status === "submitted";
    if (!created.reused) {
        // Even a thrown placement error must not hide the saved order —
        // the confirmation always returns; operators reconcile via queue.
        const placement = await placeMastershopCodOrder(order.id).catch(() => null);
        supplierSubmitted = placement !== null && "ok" in placement;
    }

    const origin = publicSiteOrigin() || new URL(request.url).origin;
    return NextResponse.json(
        {
            ref: order.ref,
            orderAccess: order.lookup_token,
            checkoutUrl: `${origin}/checkout/confirmacion?ref=${encodeURIComponent(order.ref)}&t=${order.lookup_token}`,
            supplierSubmitted,
        },
        { status: created.reused ? 200 : 201 }
    );
}

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    // Only the two documented methods exist — anything else is a client bug,
    // not a silent Wompi fallback.
    const rawMethod = body.paymentMethod;
    if (rawMethod !== undefined && rawMethod !== "wompi" && rawMethod !== "cash_on_delivery") {
        return NextResponse.json({ error: "Método de pago no válido." }, { status: 400 });
    }
    const paymentMethod = rawMethod === "cash_on_delivery" ? "cash_on_delivery" : "wompi";

    const parsed = sanitizeOrderInput(body);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (paymentMethod === "cash_on_delivery") {
        // COD never touches Wompi config, links or transactions.
        return handleCodCheckout(
            request,
            { ...parsed.input, checkoutAttemptId: body.checkoutAttemptId, pointsToRedeem: body.pointsToRedeem }
        );
    }

    const env = getWompiEnv();
    if (!env) {
        return NextResponse.json(
            { error: "Los pagos aún no están disponibles." },
            { status: 503 }
        );
    }

    const priced = await priceOrder(
        parsed.input.items,
        parsed.input.couponCode,
        undefined,
        parsed.input.customer.city
    );
    if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: 400 });
    }

    // Puntos Honesty redemption requires a verified session and a real balance —
    // browser-side points are never trusted. The points are debited inside
    // createPendingOrder so a failed order never consumes them.
    let loyalty: { userId: string; points: number } | null = null;
    if (typeof body.pointsToRedeem === "number" && body.pointsToRedeem > 0) {
        const points = Math.floor(body.pointsToRedeem);
        const user = await getVerifiedUser();
        if (!user) {
            return NextResponse.json(
                { error: "Inicia sesión para canjear puntos." },
                { status: 401 }
            );
        }
        const balance = await getLoyaltyBalance(user.id);
        if ("error" in balance) {
            return NextResponse.json({ error: "No se pudo verificar el saldo de puntos." }, { status: 500 });
        }
        if (points > balance.points) {
            return NextResponse.json({ error: "Puntos insuficientes." }, { status: 400 });
        }
        const maxRedeemable = Math.floor(priced.pricing.subtotalCop / POINT_VALUE_COP);
        if (points > maxRedeemable) {
            return NextResponse.json(
                { error: `Máximo canjeable en este pedido: ${maxRedeemable} pts.` },
                { status: 400 }
            );
        }
        loyalty = { userId: user.id, points };
    }

    const created = await createPendingOrder(
        parsed.input.customer,
        priced.pricing,
        new Date().toISOString(),
        loyalty
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
            name: `Pedido ${order.ref} — Honesty`,
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
