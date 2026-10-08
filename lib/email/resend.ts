import { getResendEnv } from "../env.ts";
import type { OrderItemRow, OrderRow } from "../orders/types.ts";
import type { FetchLike } from "../trends/http.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

function formatCop(amount: number): string {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
    }).format(amount);
}

function esc(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function orderEmailHtml(order: OrderRow, items: OrderItemRow[]): string {
    const rows = items
        .map(
            (item) => `<tr>
        <td style="padding:6px 0;color:#333">${esc(item.name)} × ${item.quantity}</td>
        <td style="padding:6px 0;text-align:right;color:#333">${formatCop(item.unit_price_cop * item.quantity)}</td>
    </tr>`
        )
        .join("");
    return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#6d28d9">LuzMágica — Pedido ${esc(order.ref)}</h2>
    <p>Hola ${esc(order.customer_name)}, tu pago fue confirmado. Este es el resumen de tu pedido:</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="border-top:1px solid #eee;padding-top:8px">
        Envío: ${formatCop(order.shipping_cop)}<br>
        ${order.discount_cop > 0 ? `Descuento: -${formatCop(order.discount_cop)}<br>` : ""}
        <strong>Total pagado: ${formatCop(order.total_cop)}</strong>
    </p>
    <p>Destino: ${esc(order.city)}${order.department ? `, ${esc(order.department)}` : ""}</p>
    <p style="color:#666;font-size:12px">
        Guarda tu referencia <strong>${esc(order.ref)}</strong> — con ella y tu teléfono puedes
        consultar el estado del despacho en la página de rastreo de la tienda.
    </p>
</div>`;
}

function statusEmailHtml(order: OrderRow, title: string, detail: string): string {
    return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#6d28d9">LuzMágica — Pedido ${esc(order.ref)}</h2>
    <p>Hola ${esc(order.customer_name)},</p>
    <p><strong>${esc(title)}</strong></p>
    <p>${esc(detail)}</p>
    <p style="color:#666;font-size:12px">
        Consulta el estado completo en la página de rastreo de la tienda con tu
        referencia <strong>${esc(order.ref)}</strong> y el teléfono de la compra.
    </p>
</div>`;
}

// Customer-facing order lifecycle notification (status transitions,
// tracking assignment, cancellations, refunds). Best-effort — never
// changes order state.
export async function sendOrderStatusEmail(
    order: OrderRow,
    subject: string,
    title: string,
    detail: string,
    fetchImpl?: FetchLike
): Promise<{ ok: true } | { ok: false; error: string }> {
    const env = getResendEnv();
    if (!env) return { ok: false, error: "resend not configured" };
    const fetcher = fetchImpl ?? fetch;
    try {
        const res = await fetcher(RESEND_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.apiKey}`,
            },
            body: JSON.stringify({
                from: env.from,
                to: [order.customer_email],
                subject,
                html: statusEmailHtml(order, title, detail),
            }),
        });
        if (!res.ok) {
            const body: unknown = await res.json().catch(() => null);
            const msg =
                body && typeof body === "object"
                    ? (body as { message?: unknown }).message
                    : null;
            return { ok: false, error: `resend ${res.status}: ${String(msg ?? "")}` };
        }
        return { ok: true };
    } catch {
        return { ok: false, error: "resend request failed" };
    }
}

// Sends the post-payment confirmation. Best-effort: any failure is reported
// to the caller but must never change payment state.
export async function sendOrderConfirmationEmail(
    order: OrderRow,
    items: OrderItemRow[],
    fetchImpl?: FetchLike
): Promise<{ ok: true } | { ok: false; error: string }> {
    const env = getResendEnv();
    if (!env) return { ok: false, error: "resend not configured" };
    const fetcher = fetchImpl ?? fetch;
    try {
        const res = await fetcher(RESEND_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.apiKey}`,
            },
            body: JSON.stringify({
                from: env.from,
                to: [order.customer_email],
                subject: `LuzMágica — Pedido ${order.ref} confirmado`,
                html: orderEmailHtml(order, items),
            }),
        });
        if (!res.ok) {
            const body: unknown = await res.json().catch(() => null);
            const msg =
                body && typeof body === "object"
                    ? (body as { message?: unknown }).message
                    : null;
            return { ok: false, error: `resend ${res.status}: ${String(msg ?? "")}` };
        }
        return { ok: true };
    } catch {
        return { ok: false, error: "resend request failed" };
    }
}
