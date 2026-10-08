import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import {
    createRefundRequest,
    getOrderRow,
    updateOrderAdmin,
    updateRefundRequest,
} from "@/lib/orders/repository";
import { voidTransaction } from "@/lib/payments/wompi";
import { sendOrderStatusEmail } from "@/lib/email/resend";
import { isPlainObject } from "@/lib/catalog/validate";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// Guided refund: records an auditable refund_request, attempts a Wompi void
// (only possible for eligible card transactions — Wompi has no general
// refund endpoint), then marks the order refunded. The response tells the
// operator exactly what to do manually when the void isn't available.
export async function POST(request: Request, context: RouteContext) {
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
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    if (!reason) {
        return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;

    const loaded = await getOrderRow(id);
    if ("error" in loaded) {
        return NextResponse.json(loaded, { status: 404 });
    }
    const order = loaded.order;
    if (order.payment_status !== "paid") {
        return NextResponse.json({ error: "only paid orders can be refunded" }, { status: 400 });
    }

    const amountCop =
        body.amountCop === undefined
            ? order.total_cop
            : typeof body.amountCop === "number" && Number.isInteger(body.amountCop)
              ? body.amountCop
              : NaN;
    if (!Number.isInteger(amountCop) || amountCop <= 0 || amountCop > order.total_cop) {
        return NextResponse.json({ error: "invalid refund amount" }, { status: 400 });
    }

    const created = await createRefundRequest({ orderId: id, amountCop, reason, notes });
    if ("error" in created) {
        return NextResponse.json(created, { status: 500 });
    }
    const refundId = created.refund.id;

    let voidOutcome: { attempted: boolean; ok: boolean; detail: string } = {
        attempted: false,
        ok: false,
        detail: "La orden no tiene transacción de Wompi registrada.",
    };
    if (order.wompi_transaction_id) {
        const voided = await voidTransaction(order.wompi_transaction_id);
        voidOutcome = {
            attempted: true,
            ok: voided.ok,
            detail: voided.ok
                ? `Anulación enviada a Wompi (estado: ${voided.status ?? "procesando"}).`
                : `La anulación automática no aplicó: ${voided.error}`,
        };
        await updateRefundRequest(refundId, {
            status: voided.ok ? "void_attempted" : "manual_required",
            wompi_void_result: { ok: voided.ok, status: voided.ok ? voided.status : voided.error },
        });
    } else {
        await updateRefundRequest(refundId, { status: "manual_required" });
    }

    const refunded = await updateOrderAdmin(id, { action: "refund" });
    if ("error" in refunded) {
        await updateRefundRequest(refundId, { status: "failed", notes: refunded.error });
        return NextResponse.json({ error: refunded.error }, { status: 400 });
    }
    await updateRefundRequest(refundId, { status: "completed" });

    const sent = await sendOrderStatusEmail(
        refunded.order,
        `LuzMágica — Pedido ${refunded.order.ref} reembolsado`,
        "Reembolso registrado",
        `Se registró un reembolso por ${amountCop.toLocaleString("es-CO")} COP. La acreditación depende de tu banco o medio de pago.`
    );
    if (!sent.ok) {
        console.error(`refund email failed (${refunded.order.ref}): ${sent.error}`);
    }

    return NextResponse.json({
        ok: true,
        refundId,
        voidOutcome,
        manualInstructions: voidOutcome.ok
            ? null
            : "Ejecuta el reembolso manualmente en el panel de Wompi (Transacciones → buscar la transacción → Reembolsar). Este panel ya registró el estado.",
    });
}
