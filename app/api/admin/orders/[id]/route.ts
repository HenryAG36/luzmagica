import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { updateOrderAdmin } from "@/lib/orders/repository";
import { sendOrderStatusEmail } from "@/lib/email/resend";
import { FULFILLMENT_STATUS_LABELS, type FulfillmentStatus } from "@/lib/orders/types";
import { isPlainObject } from "@/lib/catalog/validate";

interface RouteContext {
    params: Promise<{ id: string }>;
}

const FULFILLMENT_STATUSES = new Set<FulfillmentStatus>([
    "awaiting_payment",
    "payment_confirmed",
    "supplier_processing",
    "international_transit",
    "customs_cleared",
    "local_delivery",
    "delivered",
    "cancelled",
]);

function checkOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get("origin");
    if (!origin) return null;
    try {
        if (new URL(origin).origin !== new URL(request.url).origin) {
            return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
    return null;
}

export async function PATCH(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const forbidden = checkOrigin(request);
    if (forbidden) return forbidden;

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

    const action = body.action === undefined ? "update" : body.action;
    if (action !== "update" && action !== "cancel" && action !== "refund") {
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    let fulfillmentStatus: FulfillmentStatus | undefined;
    if (body.fulfillmentStatus !== undefined) {
        if (typeof body.fulfillmentStatus !== "string" || !FULFILLMENT_STATUSES.has(body.fulfillmentStatus as FulfillmentStatus)) {
            return NextResponse.json({ error: "invalid fulfillment status" }, { status: 400 });
        }
        fulfillmentStatus = body.fulfillmentStatus as FulfillmentStatus;
    }

    const trackingNumber =
        body.trackingNumber === undefined || body.trackingNumber === null
            ? undefined
            : typeof body.trackingNumber === "string" && body.trackingNumber.trim().length <= 64
              ? body.trackingNumber.trim()
              : undefined;
    if (body.trackingNumber !== undefined && body.trackingNumber !== null && trackingNumber === undefined) {
        return NextResponse.json({ error: "invalid tracking number" }, { status: 400 });
    }
    const carrier =
        body.carrier === undefined || body.carrier === null
            ? undefined
            : typeof body.carrier === "string" && body.carrier.trim().length <= 64
              ? body.carrier.trim()
              : undefined;
    if (body.carrier !== undefined && body.carrier !== null && carrier === undefined) {
        return NextResponse.json({ error: "invalid carrier" }, { status: 400 });
    }
    const expectedUpdatedAt =
        typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;

    const result = await updateOrderAdmin(id, {
        action,
        fulfillmentStatus,
        trackingNumber,
        carrier,
        expectedUpdatedAt,
    });
    if ("error" in result) {
        const status = result.error.includes("changed") ? 409 : result.error === "order not found" ? 404 : 400;
        return NextResponse.json(result, { status });
    }

    // Customer lifecycle email — best-effort, never blocks or rolls back the
    // update. Only fires on real transitions: status change, tracking added,
    // cancel, or refund.
    const order = result.order;
    let email: { subject: string; title: string; detail: string } | null = null;
    if (action === "cancel") {
        email = {
            subject: `LuzMágica — Pedido ${order.ref} cancelado`,
            title: "Tu pedido fue cancelado",
            detail: "No se realizó ningún cargo confirmado. Si tienes dudas, contáctanos con tu referencia.",
        };
    } else if (action === "refund") {
        email = {
            subject: `LuzMágica — Pedido ${order.ref} reembolsado`,
            title: "Reembolso registrado",
            detail: "Tu pago fue procesado para reembolso. La acreditación depende de tu banco o medio de pago.",
        };
    } else if (fulfillmentStatus) {
        const label = FULFILLMENT_STATUS_LABELS[fulfillmentStatus];
        email = {
            subject: `LuzMágica — Pedido ${order.ref}: ${label}`,
            title: `Tu pedido avanzó a: ${label}`,
            detail: order.tracking_number
                ? `Transportadora: ${order.carrier ?? "por definir"} • Guía: ${order.tracking_number}`
                : "Puedes seguir el estado en la página de rastreo.",
        };
    } else if (trackingNumber) {
        email = {
            subject: `LuzMágica — Pedido ${order.ref}: guía registrada`,
            title: "Tu pedido ya tiene guía de despacho",
            detail: `Transportadora: ${order.carrier ?? "por definir"} • Guía: ${order.tracking_number}`,
        };
    }
    if (email) {
        const sent = await sendOrderStatusEmail(order, email.subject, email.title, email.detail);
        if (!sent.ok) {
            console.error(`order status email failed (${order.ref}): ${sent.error}`);
        }
    }

    return NextResponse.json({ ok: true });
}
