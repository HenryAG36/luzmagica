import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type {
    FulfillmentStatus,
    OrderCustomer,
    OrderEventRow,
    OrderItemRow,
    OrderPricing,
    OrderRow,
    PublicOrder,
    PublicOrderEvent,
} from "./types.ts";
import { FULFILLMENT_STATUS_LABELS } from "./types.ts";
import { normalizePhone } from "./validate.ts";

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const FULFILLMENT_SEQUENCE: FulfillmentStatus[] = [
    "payment_confirmed",
    "supplier_processing",
    "international_transit",
    "customs_cleared",
    "local_delivery",
    "delivered",
];

export function cartFingerprint(items: { productId: string; quantity: number }[]): string {
    const canonical = items
        .map((i) => `${i.productId}:${i.quantity}`)
        .sort()
        .join("|");
    return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32);
}

function generateRef(): string {
    return `LM-${randomInt(100000, 1000000)}`;
}

export interface CreateOrderResult {
    ok: true;
    order: OrderRow;
    reused: boolean;
}

export async function createPendingOrder(
    customer: OrderCustomer,
    pricing: OrderPricing,
    consentAt: string,
    provided?: SupabaseClientLike
): Promise<CreateOrderResult | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const fingerprint = cartFingerprint(pricing.items);
    const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const { data: dupes } = await service
        .from("orders")
        .select("*")
        .eq("customer_phone", customer.phone)
        .eq("cart_fingerprint", fingerprint)
        .eq("payment_status", "pending_payment")
        .gt("created_at", windowStart);
    const existing = ((dupes as OrderRow[] | null) ?? [])[0];
    if (existing) return { ok: true, order: existing, reused: true };

    const lookupToken = randomBytes(32).toString("hex");
    const now = new Date().toISOString();
    let order: OrderRow | null = null;

    for (let attempt = 0; attempt < 5 && !order; attempt++) {
        const row = {
            id: randomUUID(),
            ref: generateRef(),
            lookup_token: lookupToken,
            cart_fingerprint: fingerprint,
            customer_name: customer.name,
            customer_email: customer.email,
            customer_phone: customer.phone,
            customer_cedula: customer.cedula,
            address: customer.address,
            city: customer.city,
            department: customer.department,
            notes: customer.notes,
            subtotal_cop: pricing.subtotalCop,
            discount_cop: pricing.discountCop,
            shipping_cop: pricing.shippingCop,
            total_cop: pricing.totalCop,
            coupon_code: pricing.couponCode,
            payment_status: "pending_payment",
            fulfillment_status: "awaiting_payment",
            consent_at: consentAt,
            created_at: now,
            updated_at: now,
        };
        const { error } = await service.from("orders").insert(row);
        if (error) {
            if (error.code === "23505" || /duplicate|unique/i.test(error.message)) continue;
            return { error: error.message };
        }
        order = row as OrderRow;
    }
    if (!order) return { error: "could not allocate order ref" };

    const itemRows = pricing.items.map((item) => ({
        order_id: order!.id,
        product_id: item.productId,
        name: item.name,
        unit_price_cop: item.unitPriceCop,
        quantity: item.quantity,
        unit_shipping_cop: item.unitShippingCop,
        unit_supplier_cost_cop: item.unitSupplierCostCop,
        source: item.source,
        supplier_variant: item.supplierVariant,
    }));
    const { error: itemsError } = await service.from("order_items").insert(itemRows);
    if (itemsError) return { error: itemsError.message };

    await insertOrderEvent(
        service,
        order.id,
        "payment",
        "pending_payment",
        "Pedido creado",
        "Pedido registrado; esperando confirmación del pago."
    );

    return { ok: true, order, reused: false };
}

export async function attachPaymentLink(
    orderId: string,
    link: { id: string; url: string },
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { error } = await service
        .from("orders")
        .update({
            payment_link_id: link.id,
            payment_link_url: link.url,
            updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);
    if (error) return { error: error.message };
    return { ok: true };
}

async function insertOrderEvent(
    service: SupabaseClientLike,
    orderId: string,
    kind: "payment" | "fulfillment" | "note",
    status: string,
    label: string,
    description: string
) {
    await service.from("order_events").insert({
        order_id: orderId,
        kind,
        status,
        label,
        description,
    });
}

async function loadOrderItems(service: SupabaseClientLike, orderId: string): Promise<OrderItemRow[]> {
    const { data } = await service.from("order_items").select("*").eq("order_id", orderId);
    return (data as OrderItemRow[] | null) ?? [];
}

async function decrementStock(service: SupabaseClientLike, items: OrderItemRow[]) {
    const ids = items.map((i) => i.product_id);
    const { data } = await service.from("catalog_products").select("id,stock").in("id", ids);
    const rows = (data as { id: string; stock: number }[] | null) ?? [];
    for (const item of items) {
        const row = rows.find((r) => r.id === item.product_id);
        if (!row) continue;
        const next = Math.max(0, (row.stock ?? 0) - item.quantity);
        await service
            .from("catalog_products")
            .update({ stock: next, updated_at: new Date().toISOString() })
            .eq("id", item.product_id);
    }
}

export interface WompiEventInput {
    transactionId: string;
    status: string;
    amountInCents: number | null;
    paymentLinkId: string | null;
    checksum: string;
    payload: unknown;
}

// Applies a signature-verified Wompi transaction event. Idempotent:
// (provider, transaction_id, status) is unique — retried deliveries are
// skipped. Only 'pending_payment' orders transition; anything else gets an
// audit note so a late/mismatched event can never silently mutate state.
export interface WompiEventApplied {
    ok: true;
    outcome: string;
    // Present only when a fresh APPROVED event transitioned the order to
    // paid — lets the caller trigger the confirmation email exactly once.
    paidOrder?: { order: OrderRow; items: OrderItemRow[] };
}

export async function applyWompiEvent(
    input: WompiEventInput,
    provided?: SupabaseClientLike
): Promise<WompiEventApplied | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data: marker } = await service
        .from("payment_events")
        .select("id")
        .eq("provider", "wompi")
        .eq("transaction_id", input.transactionId)
        .eq("status", input.status);
    if (((marker as { id: number }[] | null) ?? []).length > 0) {
        return { ok: true, outcome: "duplicate" };
    }

    const recordMarker = async (orderId: string | null) => {
        await service.from("payment_events").insert({
            provider: "wompi",
            transaction_id: input.transactionId,
            order_id: orderId,
            status: input.status,
            amount_in_cents: input.amountInCents,
            checksum: input.checksum,
            payload: input.payload ?? null,
        });
    };

    let order: OrderRow | null = null;
    if (input.paymentLinkId) {
        const { data } = await service
            .from("orders")
            .select("*")
            .eq("payment_link_id", input.paymentLinkId)
            .maybeSingle();
        order = (data as OrderRow | null) ?? null;
    }
    if (!order) {
        await recordMarker(null);
        return { ok: true, outcome: "unmatched" };
    }

    const note = async (label: string, description: string) => {
        await insertOrderEvent(service, order!.id, "payment", input.status.toLowerCase(), label, description);
        await recordMarker(order!.id);
    };

    if (order.payment_status !== "pending_payment") {
        await note(
            "Evento de pago recibido",
            `Wompi reportó "${input.status}" para una orden que ya no está pendiente.`
        );
        return { ok: true, outcome: "ignored_terminal" };
    }

    if (input.status === "APPROVED") {
        if (input.amountInCents !== order.total_cop * 100) {
            const { error } = await service
                .from("orders")
                .update({ payment_status: "payment_review", updated_at: new Date().toISOString() })
                .eq("id", order.id)
                .eq("payment_status", "pending_payment");
            if (error) return { error: error.message };
            await insertOrderEvent(
                service,
                order.id,
                "payment",
                "payment_review",
                "Pago en revisión",
                "El monto reportado por la pasarela no coincide con el pedido; será revisado manualmente."
            );
            await recordMarker(order.id);
            return { ok: true, outcome: "amount_mismatch" };
        }

        const now = new Date().toISOString();
        const { data: updated, error } = await service
            .from("orders")
            .update({
                payment_status: "paid",
                fulfillment_status: "payment_confirmed",
                wompi_transaction_id: input.transactionId,
                paid_at: now,
                updated_at: now,
            })
            .eq("id", order.id)
            .eq("payment_status", "pending_payment")
            .select("id");
        if (error) return { error: error.message };
        if (((updated as { id: string }[] | null) ?? []).length === 0) {
            await note("Evento de pago recibido", "La orden ya había sido procesada.");
            return { ok: true, outcome: "ignored_terminal" };
        }

        await insertOrderEvent(
            service,
            order.id,
            "payment",
            "paid",
            "Pago aprobado",
            "La pasarela confirmó el pago del pedido."
        );
        const items = await loadOrderItems(service, order.id);
        await decrementStock(service, items);
        await recordMarker(order.id);
        return { ok: true, outcome: "paid", paidOrder: { order, items } };
    }

    if (input.status === "DECLINED" || input.status === "ERROR" || input.status === "VOIDED") {
        const { error } = await service
            .from("orders")
            .update({ payment_status: "payment_failed", updated_at: new Date().toISOString() })
            .eq("id", order.id)
            .eq("payment_status", "pending_payment");
        if (error) return { error: error.message };
        await insertOrderEvent(
            service,
            order.id,
            "payment",
            "payment_failed",
            "Pago no aprobado",
            "La transacción fue rechazada o expiró."
        );
        await recordMarker(order.id);
        return { ok: true, outcome: "failed" };
    }

    await note("Pago en proceso", `La pasarela reportó el estado "${input.status}".`);
    return { ok: true, outcome: "recorded" };
}

// ---------- guest + account-facing reads ----------

export function toPublicOrder(
    order: OrderRow,
    items: OrderItemRow[],
    events: OrderEventRow[]
): PublicOrder {
    return {
        ref: order.ref,
        createdAt: order.created_at,
        city: order.city,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        items: items.map((i) => ({
            productId: i.product_id,
            name: i.name,
            unitPriceCop: i.unit_price_cop,
            quantity: i.quantity,
            unitShippingCop: i.unit_shipping_cop,
        })),
        subtotalCop: order.subtotal_cop,
        discountCop: order.discount_cop,
        shippingCop: order.shipping_cop,
        totalCop: order.total_cop,
        trackingNumber: order.tracking_number,
        carrier: order.carrier,
        events: events
            .map((e): PublicOrderEvent => ({
                status: e.status,
                label: e.label,
                description: e.description,
                timestamp: e.created_at,
            }))
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    };
}

async function loadEvents(service: SupabaseClientLike, orderIds: string[]): Promise<OrderEventRow[]> {
    if (orderIds.length === 0) return [];
    const { data } = await service.from("order_events").select("*").in("order_id", orderIds);
    return (data as OrderEventRow[] | null) ?? [];
}

async function loadItemsFor(service: SupabaseClientLike, orderIds: string[]): Promise<OrderItemRow[]> {
    if (orderIds.length === 0) return [];
    const { data } = await service.from("order_items").select("*").in("order_id", orderIds);
    return (data as OrderItemRow[] | null) ?? [];
}

// Non-enumerating: wrong ref and wrong contact produce the same null result.
export async function lookupForGuest(
    ref: string,
    contact: string,
    provided?: SupabaseClientLike
): Promise<PublicOrder | null> {
    const service = await serviceClient(provided);
    if (!service) return null;

    const { data } = await service.from("orders").select("*").eq("ref", ref).maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return null;

    const isEmail = contact.includes("@");
    let matches: boolean;
    if (isEmail) {
        matches = order.customer_email.toLowerCase() === contact.trim().toLowerCase();
    } else {
        // Customers may enter +57/country-code variants — compare the last
        // 10 digits (Colombian mobile length) when both sides have them.
        const stored = normalizePhone(order.customer_phone);
        const entered = normalizePhone(contact);
        matches =
            stored === entered ||
            (stored.length >= 10 && entered.length >= 10 && stored.slice(-10) === entered.slice(-10));
    }
    if (!matches) return null;

    const [items, events] = await Promise.all([
        loadOrderItems(service, order.id),
        loadEvents(service, [order.id]),
    ]);
    return toPublicOrder(order, items, events);
}

export async function lookupByToken(
    ref: string,
    token: string,
    provided?: SupabaseClientLike
): Promise<PublicOrder | null> {
    const service = await serviceClient(provided);
    if (!service) return null;
    const { data } = await service
        .from("orders")
        .select("*")
        .eq("ref", ref)
        .eq("lookup_token", token)
        .maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return null;
    const [items, events] = await Promise.all([
        loadOrderItems(service, order.id),
        loadEvents(service, [order.id]),
    ]);
    return toPublicOrder(order, items, events);
}

export async function listOrdersByEmail(
    email: string,
    provided?: SupabaseClientLike
): Promise<PublicOrder[]> {
    const service = await serviceClient(provided);
    if (!service) return [];
    const { data } = await service
        .from("orders")
        .select("*")
        .eq("customer_email", email.trim().toLowerCase())
        .order("created_at");
    const orders = ((data as OrderRow[] | null) ?? []).reverse();
    const ids = orders.map((o) => o.id);
    const [items, events] = await Promise.all([
        loadItemsFor(service, ids),
        loadEvents(service, ids),
    ]);
    return orders.map((o) =>
        toPublicOrder(
            o,
            items.filter((i) => i.order_id === o.id),
            events.filter((e) => e.order_id === o.id)
        )
    );
}

// ---------- admin reads/writes ----------

export interface AdminOrderListItem extends OrderRow {
    items: OrderItemRow[];
    events: OrderEventRow[];
}

const ADMIN_PAGE_MAX = 50;

export async function listOrdersForAdmin(
    opts: { paymentStatus?: string; limit?: number; offset?: number } = {},
    provided?: SupabaseClientLike
): Promise<{ orders: AdminOrderListItem[] } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const limit =
        Number.isInteger(opts.limit) && (opts.limit as number) > 0
            ? Math.min(opts.limit as number, ADMIN_PAGE_MAX)
            : ADMIN_PAGE_MAX;
    const offset = Number.isInteger(opts.offset) && (opts.offset as number) >= 0 ? (opts.offset as number) : 0;

    let query = service.from("orders").select("*").order("created_at").range(offset, offset + limit - 1);
    if (opts.paymentStatus) query = query.eq("payment_status", opts.paymentStatus);
    const { data, error } = await query;
    if (error) return { error: error.message };
    const orders = ((data as OrderRow[] | null) ?? []).reverse();
    const ids = orders.map((o) => o.id);
    const [items, events] = await Promise.all([
        loadItemsFor(service, ids),
        loadEvents(service, ids),
    ]);
    return {
        orders: orders.map((o) => ({
            ...o,
            items: items.filter((i) => i.order_id === o.id),
            events: events.filter((e) => e.order_id === o.id),
        })),
    };
}

export interface OrderSummary {
    paidCount: number;
    paidRevenueCop: number;
    pendingCount: number;
    pendingRevenueCop: number;
    supplierCostCop: number;
    reviewCount: number;
    deliveredCount: number;
    totalCount: number;
}

export async function getOrderSummary(
    provided?: SupabaseClientLike
): Promise<OrderSummary | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data, error } = await service
        .from("orders")
        .select("id,payment_status,fulfillment_status,total_cop");
    if (error) return { error: error.message };
    const rows =
        (data as Pick<OrderRow, "id" | "payment_status" | "fulfillment_status" | "total_cop">[] | null) ??
        [];
    const summary: OrderSummary = {
        paidCount: 0,
        paidRevenueCop: 0,
        pendingCount: 0,
        pendingRevenueCop: 0,
        supplierCostCop: 0,
        reviewCount: 0,
        deliveredCount: 0,
        totalCount: rows.length,
    };
    const paidIds: string[] = [];
    for (const row of rows) {
        if (row.payment_status === "paid") {
            summary.paidCount += 1;
            summary.paidRevenueCop += row.total_cop;
            paidIds.push(row.id);
        }
        if (row.payment_status === "pending_payment") {
            summary.pendingCount += 1;
            summary.pendingRevenueCop += row.total_cop;
        }
        if (row.payment_status === "payment_review") summary.reviewCount += 1;
        if (row.fulfillment_status === "delivered") summary.deliveredCount += 1;
    }
    if (paidIds.length > 0) {
        const { data: itemRows } = await service
            .from("order_items")
            .select("quantity,unit_supplier_cost_cop")
            .in("order_id", paidIds);
        const items =
            (itemRows as Pick<OrderItemRow, "quantity" | "unit_supplier_cost_cop">[] | null) ?? [];
        for (const item of items) {
            summary.supplierCostCop += (item.unit_supplier_cost_cop ?? 0) * item.quantity;
        }
    }
    return summary;
}

export function canTransitionFulfillment(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
    if (from === to) return false;
    if (to === "cancelled") return from !== "delivered" && from !== "cancelled";
    const fromIdx = FULFILLMENT_SEQUENCE.indexOf(from);
    const toIdx = FULFILLMENT_SEQUENCE.indexOf(to);
    return fromIdx >= 0 && toIdx > fromIdx;
}

export type AdminOrderAction = "update" | "cancel" | "refund";

export async function updateOrderAdmin(
    id: string,
    input: {
        action?: AdminOrderAction;
        fulfillmentStatus?: FulfillmentStatus;
        trackingNumber?: string | null;
        carrier?: string | null;
        expectedUpdatedAt?: string;
    },
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data: rowData } = await service.from("orders").select("*").eq("id", id).maybeSingle();
    const order = (rowData as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== order.updated_at) {
        return { error: "order changed during edit; reload and retry" };
    }

    const action: AdminOrderAction = input.action ?? "update";
    const now = new Date().toISOString();

    if (action === "cancel") {
        if (order.payment_status !== "pending_payment" && order.payment_status !== "payment_failed") {
            return { error: "only unpaid orders can be cancelled" };
        }
        const { data: updated, error } = await service
            .from("orders")
            .update({ payment_status: "cancelled", fulfillment_status: "cancelled", updated_at: now })
            .eq("id", id)
            .eq("updated_at", order.updated_at)
            .select("id");
        if (error) return { error: error.message };
        if (((updated as { id: string }[] | null) ?? []).length === 0) {
            return { error: "order changed during edit; reload and retry" };
        }
        await insertOrderEvent(service, id, "payment", "cancelled", "Pedido cancelado", "El pedido fue cancelado por el operador.");
        return { ok: true };
    }

    if (action === "refund") {
        if (order.payment_status !== "paid") return { error: "only paid orders can be refunded" };
        const { data: updated, error } = await service
            .from("orders")
            .update({ payment_status: "refunded", fulfillment_status: "cancelled", updated_at: now })
            .eq("id", id)
            .eq("updated_at", order.updated_at)
            .select("id");
        if (error) return { error: error.message };
        if (((updated as { id: string }[] | null) ?? []).length === 0) {
            return { error: "order changed during edit; reload and retry" };
        }
        await insertOrderEvent(
            service,
            id,
            "payment",
            "refunded",
            "Pago reembolsado",
            "El reembolso fue registrado por el operador tras procesarlo en la pasarela."
        );
        return { ok: true };
    }

    if (order.payment_status === "cancelled" || order.payment_status === "refunded") {
        return { error: "order is closed" };
    }
    if (order.payment_status === "payment_review") {
        return { error: "resolve the payment review before updating fulfillment" };
    }

    const fields: Record<string, unknown> = {};
    if (input.fulfillmentStatus !== undefined) {
        if (!canTransitionFulfillment(order.fulfillment_status, input.fulfillmentStatus)) {
            return { error: "invalid fulfillment transition" };
        }
        fields.fulfillment_status = input.fulfillmentStatus;
    }
    if (input.trackingNumber !== undefined) fields.tracking_number = input.trackingNumber;
    if (input.carrier !== undefined) fields.carrier = input.carrier;
    if (Object.keys(fields).length === 0) return { ok: true };

    const { data: updated, error } = await service
        .from("orders")
        .update({ ...fields, updated_at: now })
        .eq("id", id)
        .eq("updated_at", order.updated_at)
        .select("id");
    if (error) return { error: error.message };
    if (((updated as { id: string }[] | null) ?? []).length === 0) {
        return { error: "order changed during edit; reload and retry" };
    }

    if (typeof fields.fulfillment_status === "string") {
        const status = fields.fulfillment_status as FulfillmentStatus;
        await insertOrderEvent(
            service,
            id,
            "fulfillment",
            status,
            FULFILLMENT_STATUS_LABELS[status],
            "Estado actualizado por el operador."
        );
    }
    if (input.trackingNumber) {
        await insertOrderEvent(
            service,
            id,
            "fulfillment",
            String(fields.fulfillment_status ?? order.fulfillment_status),
            "Guía registrada",
            `${input.carrier ?? "Transportadora"}: ${input.trackingNumber}`
        );
    }
    return { ok: true };
}
