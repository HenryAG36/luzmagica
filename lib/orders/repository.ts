import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type {
    FulfillmentStatus,
    OrderCustomer,
    OrderEventRow,
    OrderItemRow,
    OrderPricing,
    OrderRow,
    ProductReviewRow,
    PublicClaim,
    PublicOrder,
    PublicOrderEvent,
    PublicReview,
    RefundRequestRow,
    SupplierClaimRow,
} from "./types.ts";
import { FULFILLMENT_STATUS_LABELS } from "./types.ts";
import { normalizePhone } from "./validate.ts";
import {
    awardPointsForOrder,
    redeemPointsForOrder,
    restorePointsForOrder,
    POINT_VALUE_COP,
} from "../loyalty/service.ts";

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const SUPPLIER_SOURCES = new Set(["aliexpress_ds", "cjdropshipping"]);
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
    loyalty?: { userId: string; points: number } | null,
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
    // Reuse only when the recomputed totals still match — a different
    // discount/points request must produce a new order.
    if (existing && existing.total_cop === pricing.totalCop && existing.subtotal_cop === pricing.subtotalCop) {
        return { ok: true, order: existing, reused: true };
    }

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
            discount_cop: pricing.discountCop + (loyalty ? loyalty.points * POINT_VALUE_COP : 0),
            shipping_cop: pricing.shippingCop,
            total_cop: Math.max(
                0,
                pricing.totalCop - (loyalty ? loyalty.points * POINT_VALUE_COP : 0)
            ),
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

    if (loyalty && loyalty.points > 0) {
        const redeemed = await redeemPointsForOrder(loyalty.userId, order.id, loyalty.points, service);
        if ("error" in redeemed) {
            await service
                .from("orders")
                .update({
                    payment_status: "cancelled",
                    fulfillment_status: "cancelled",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", order.id);
            return { error: redeemed.error === "insufficient points" ? "Puntos insuficientes." : "No se pudieron canjear los puntos; intenta de nuevo." };
        }
        await insertOrderEvent(
            service,
            order.id,
            "payment",
            "pending_payment",
            "Puntos canjeados",
            `${loyalty.points} LuzPoints aplicados como descuento.`
        );
    }

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
        // Queue supplier placement when the order has provider-backed items;
        // the webhook caller (or the retry cron) executes it.
        if (items.some((i) => SUPPLIER_SOURCES.has(i.source))) {
            await service
                .from("orders")
                .update({ supplier_order_status: "queued" })
                .eq("id", order.id)
                .is("supplier_order_status", null);
        }
        await recordMarker(order.id);
        const awarded = await awardPointsForOrder({ ...order, payment_status: "paid" }, service);
        if ("error" in awarded) {
            console.error(`loyalty award failed (${order.ref}): ${awarded.error}`);
        }
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
        const restored = await restorePointsForOrder(order.id, service);
        if ("error" in restored) {
            console.error(`loyalty restore failed (${order.ref}): ${restored.error}`);
        }
        return { ok: true, outcome: "failed" };
    }

    await note("Pago en proceso", `La pasarela reportó el estado "${input.status}".`);
    return { ok: true, outcome: "recorded" };
}

// ---------- guest + account-facing reads ----------

export function toPublicOrder(
    order: OrderRow,
    items: OrderItemRow[],
    events: OrderEventRow[],
    reviewedProductIds: Set<string> = new Set(),
    claims: SupplierClaimRow[] = []
): PublicOrder {
    const productByItemId = new Map(items.map((i) => [i.id, i.product_id]));
    return {
        ref: order.ref,
        createdAt: order.created_at,
        city: order.city,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        reviewedProductIds: items
            .map((i) => i.product_id)
            .filter((pid) => reviewedProductIds.has(pid)),
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
            .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? ""))),
        claims: claims.map(
            (c): PublicClaim => ({
                productId: productByItemId.get(c.order_item_id) ?? "",
                reason: c.reason,
                status: c.status,
            })
        ),
    };
}

async function loadClaimsFor(
    service: SupabaseClientLike,
    orderIds: string[]
): Promise<Map<string, SupplierClaimRow[]>> {
    const map = new Map<string, SupplierClaimRow[]>();
    if (orderIds.length === 0) return map;
    const { data } = await service
        .from("supplier_claims")
        .select("*")
        .in("order_id", orderIds);
    for (const row of (data as SupplierClaimRow[] | null) ?? []) {
        if (!map.has(row.order_id)) map.set(row.order_id, []);
        map.get(row.order_id)!.push(row);
    }
    return map;
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

// Customers may enter +57/country-code variants — compare the last
// 10 digits (Colombian mobile length) when both sides have them.
export function orderMatchesContact(order: OrderRow, contact: string): boolean {
    if (contact.includes("@")) {
        return order.customer_email.toLowerCase() === contact.trim().toLowerCase();
    }
    const stored = normalizePhone(order.customer_phone);
    const entered = normalizePhone(contact);
    return (
        stored === entered ||
        (stored.length >= 10 && entered.length >= 10 && stored.slice(-10) === entered.slice(-10))
    );
}

async function loadReviewedProductIds(
    service: SupabaseClientLike,
    orderIds: string[]
): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (orderIds.length === 0) return map;
    const { data } = await service
        .from("product_reviews")
        .select("order_id,product_id")
        .in("order_id", orderIds);
    for (const row of (data as Pick<ProductReviewRow, "order_id" | "product_id">[] | null) ?? []) {
        if (!map.has(row.order_id)) map.set(row.order_id, new Set());
        map.get(row.order_id)!.add(row.product_id);
    }
    return map;
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
    if (!orderMatchesContact(order, contact)) return null;

    const [items, events, reviewed, claims] = await Promise.all([
        loadOrderItems(service, order.id),
        loadEvents(service, [order.id]),
        loadReviewedProductIds(service, [order.id]),
        loadClaimsFor(service, [order.id]),
    ]);
    return toPublicOrder(
        order,
        items,
        events,
        reviewed.get(order.id) ?? new Set(),
        claims.get(order.id) ?? []
    );
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
    const [items, events, reviewed, claims] = await Promise.all([
        loadOrderItems(service, order.id),
        loadEvents(service, [order.id]),
        loadReviewedProductIds(service, [order.id]),
        loadClaimsFor(service, [order.id]),
    ]);
    return toPublicOrder(
        order,
        items,
        events,
        reviewed.get(order.id) ?? new Set(),
        claims.get(order.id) ?? []
    );
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
    const [items, events, reviewed, claims] = await Promise.all([
        loadItemsFor(service, ids),
        loadEvents(service, ids),
        loadReviewedProductIds(service, ids),
        loadClaimsFor(service, ids),
    ]);
    return orders.map((o) =>
        toPublicOrder(
            o,
            items.filter((i) => i.order_id === o.id),
            events.filter((e) => e.order_id === o.id),
            reviewed.get(o.id) ?? new Set(),
            claims.get(o.id) ?? []
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

export async function getOrderRow(
    id: string,
    provided?: SupabaseClientLike
): Promise<{ order: OrderRow } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data } = await service.from("orders").select("*").eq("id", id).maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };
    return { order };
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
): Promise<{ ok: true; order: OrderRow } | { error: string }> {
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
        const restored = await restorePointsForOrder(id, service);
        if ("error" in restored) {
            console.error(`loyalty restore failed (${order.ref}): ${restored.error}`);
        }
        return { ok: true, order: { ...order, payment_status: "cancelled", fulfillment_status: "cancelled" } };
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
        const restored = await restorePointsForOrder(id, service);
        if ("error" in restored) {
            console.error(`loyalty restore failed (${order.ref}): ${restored.error}`);
        }
        return { ok: true, order: { ...order, payment_status: "refunded", fulfillment_status: "cancelled" } };
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
    if (Object.keys(fields).length === 0) return { ok: true, order };

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
    return { ok: true, order: { ...order, ...fields } as OrderRow };
}

// ---------- reviews ----------

function maskReviewerName(fullName: string): string {
    const first = fullName.trim().split(/\s+/)[0] ?? "";
    if (first.length <= 2) return `${first.charAt(0)}.`;
    return `${first.slice(0, 3)}***`;
}

// Review submission is verified against the order itself: either the
// unguessable lookup token (checkout confirmation) or ref + contact (same
// gate as guest tracking). Only delivered orders can be reviewed, and the
// unique (order_id, product_id) constraint blocks duplicates.
export async function submitOrderReview(
    input: {
        ref: string;
        token?: string | null;
        contact?: string | null;
        productId: string;
        rating: number;
        comment: string;
    },
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
        return { error: "invalid rating" };
    }
    const comment = input.comment.trim();
    if (comment.length === 0 || comment.length > 1000) {
        return { error: "invalid comment" };
    }

    const { data } = await service
        .from("orders")
        .select("*")
        .eq("ref", input.ref.trim().toUpperCase())
        .maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };

    const tokenOk =
        typeof input.token === "string" &&
        input.token.length === order.lookup_token.length &&
        input.token === order.lookup_token;
    const contactOk =
        typeof input.contact === "string" && orderMatchesContact(order, input.contact);
    if (!tokenOk && !contactOk) return { error: "order not found" };

    if (order.fulfillment_status !== "delivered") {
        return { error: "only delivered orders can be reviewed" };
    }

    const items = await loadOrderItems(service, order.id);
    if (!items.some((i) => i.product_id === input.productId)) {
        return { error: "product not in this order" };
    }

    const { error } = await service.from("product_reviews").insert({
        product_id: input.productId,
        order_id: order.id,
        rating: input.rating,
        comment,
        reviewer_name: order.customer_name,
        status: "pending",
    });
    if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
            return { error: "already reviewed" };
        }
        return { error: error.message };
    }
    return { ok: true };
}

export async function listApprovedReviewsForProduct(
    productId: string,
    provided?: SupabaseClientLike
): Promise<PublicReview[]> {
    const service = await serviceClient(provided);
    if (!service) return [];
    const { data } = await service
        .from("product_reviews")
        .select("rating,comment,reviewer_name,created_at")
        .eq("product_id", productId)
        .eq("status", "approved")
        .order("created_at");
    const rows = (data as Pick<ProductReviewRow, "rating" | "comment" | "reviewer_name" | "created_at">[] | null) ?? [];
    return rows
        .slice()
        .reverse()
        .map((r) => ({
            rating: r.rating,
            comment: r.comment,
            reviewerName: maskReviewerName(r.reviewer_name ?? ""),
            createdAt: r.created_at,
        }));
}

export interface AdminReviewRow extends ProductReviewRow {
    product_name: string | null;
    order_ref: string | null;
}

export async function listReviewsForAdmin(
    status: "pending" | "approved" | "rejected" | undefined,
    provided?: SupabaseClientLike
): Promise<{ reviews: AdminReviewRow[] } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    let query = service.from("product_reviews").select("*").order("created_at").limit(100);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    const reviews = ((data as ProductReviewRow[] | null) ?? []).reverse();

    const productIds = [...new Set(reviews.map((r) => r.product_id))];
    const orderIds = [...new Set(reviews.map((r) => r.order_id))];
    const [{ data: products }, { data: orderRows }] = await Promise.all([
        productIds.length
            ? service.from("catalog_products").select("id,name").in("id", productIds)
            : Promise.resolve({ data: [] }),
        orderIds.length
            ? service.from("orders").select("id,ref").in("id", orderIds)
            : Promise.resolve({ data: [] }),
    ]);
    const productById = new Map(
        ((products as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name])
    );
    const refById = new Map(
        ((orderRows as { id: string; ref: string }[] | null) ?? []).map((o) => [o.id, o.ref])
    );
    return {
        reviews: reviews.map((r) => ({
            ...r,
            product_name: productById.get(r.product_id) ?? null,
            order_ref: refById.get(r.order_id) ?? null,
        })),
    };
}

export async function moderateReview(
    id: string,
    status: "approved" | "rejected",
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data, error } = await service
        .from("product_reviews")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
    if (error) return { error: error.message };
    if (((data as { id: string }[] | null) ?? []).length === 0) {
        return { error: "review not found or already moderated" };
    }
    return { ok: true };
}

// ---------- attention queue ----------

const STALE_SUBMITTING_MS = 30 * 60 * 1000;
const MISSING_TRACKING_MS = 7 * 24 * 60 * 60 * 1000;

export interface AttentionQueue {
    paymentReview: number;
    supplierFailed: number;
    supplierStale: number;
    missingTracking: number;
    draftClaims: number;
    orders: { id: string; ref: string; issue: string }[];
}

// Surfaces only what a human must look at: payment mismatches, failed or
// stuck supplier placements, submitted orders that never got a tracking
// number, and customer claims awaiting review.
export async function getAttentionQueue(
    provided?: SupabaseClientLike
): Promise<AttentionQueue | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data, error } = await service
        .from("orders")
        .select("id,ref,payment_status,fulfillment_status,supplier_order_status,supplier_order_id,tracking_number,supplier_order_placed_at,updated_at,auto_fulfill_attempts");
    if (error) return { error: error.message };

    const orders = (data as Partial<OrderRow>[] | null) ?? [];
    const now = Date.now();
    const queue: AttentionQueue = {
        paymentReview: 0,
        supplierFailed: 0,
        supplierStale: 0,
        missingTracking: 0,
        draftClaims: 0,
        orders: [],
    };

    for (const o of orders) {
        if (o.payment_status === "payment_review") {
            queue.paymentReview += 1;
            queue.orders.push({ id: o.id as string, ref: o.ref as string, issue: "Monto de pago no coincide" });
            continue;
        }
        const status = o.supplier_order_status;
        const updatedAt = o.updated_at ? Date.parse(o.updated_at) : 0;
        if (status === "failed" || status === "partial") {
            queue.supplierFailed += 1;
            queue.orders.push({
                id: o.id as string,
                ref: o.ref as string,
                issue: status === "partial" ? "Proveedor: envío parcial" : "Proveedor: envío falló",
            });
        } else if (
            (status === "queued" || status === "submitting") &&
            now - updatedAt > STALE_SUBMITTING_MS
        ) {
            queue.supplierStale += 1;
            queue.orders.push({ id: o.id as string, ref: o.ref as string, issue: "Envío a proveedor atascado" });
        } else if (
            status === "submitted" &&
            !o.tracking_number &&
            o.supplier_order_placed_at &&
            now - Date.parse(o.supplier_order_placed_at) > MISSING_TRACKING_MS
        ) {
            queue.missingTracking += 1;
            queue.orders.push({ id: o.id as string, ref: o.ref as string, issue: "Sin guía tras 7 días" });
        }
    }

    const { data: claimRows } = await service
        .from("supplier_claims")
        .select("id")
        .eq("status", "draft");
    queue.draftClaims = ((claimRows as { id: string }[] | null) ?? []).length;

    queue.orders = queue.orders.slice(0, 50);
    return queue;
}

// ---------- refund requests ----------

export async function createRefundRequest(
    input: { orderId: string; amountCop: number; reason: string; notes?: string | null },
    provided?: SupabaseClientLike
): Promise<{ refund: RefundRequestRow } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const now = new Date().toISOString();
    const row = {
        id: randomUUID(),
        order_id: input.orderId,
        amount_cop: input.amountCop,
        reason: input.reason.slice(0, 500),
        status: "requested",
        notes: input.notes?.slice(0, 500) ?? null,
        created_at: now,
        updated_at: now,
    };
    const { error } = await service.from("refund_requests").insert(row);
    if (error) return { error: error.message };
    return { refund: row as RefundRequestRow };
}

export async function updateRefundRequest(
    id: string,
    patch: Partial<Pick<RefundRequestRow, "status" | "wompi_void_result" | "notes">>,
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { error } = await service
        .from("refund_requests")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) return { error: error.message };
    return { ok: true };
}

export async function listRefundRequests(
    orderId: string,
    provided?: SupabaseClientLike
): Promise<RefundRequestRow[]> {
    const service = await serviceClient(provided);
    if (!service) return [];
    const { data } = await service
        .from("refund_requests")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at");
    return (data as RefundRequestRow[] | null) ?? [];
}
