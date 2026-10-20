// Mastershop COD order submission and tracking reconciliation. The create
// contract was verified against the official Postman collection: POST
// /api/orders registers the order in "Por Confirmar" — provider creation is
// NOT payment collection and NOT dispatch confirmation; an operator confirms
// the shipment inside Mastershop. Ambiguous outcomes (timeouts, 5xx,
// unverifiable responses) are never retried blindly: after any create attempt
// we only GET the external id and reattach what the provider already has.

import type { FetchLike } from "../trends/http.ts";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type { OrderCustomer, OrderItemRow, OrderRow } from "../orders/types.ts";
import { FULFILLMENT_STATUS_LABELS } from "../orders/types.ts";
import type { FulfillmentStatus, PaymentStatus } from "../orders/types.ts";
import type { SyncOutcome } from "./tracking.ts";
import { canTransitionFulfillment } from "../orders/repository.ts";
import { isPlainObject } from "../catalog/validate.ts";
import { isMastershopCodEnabled } from "../env.ts";
import {
    isValidMastershopProductId,
    mastershopProductBelongsToAccount,
    getMastershopProduct,
    mastershopRequest,
    type MastershopResult,
} from "./mastershop.ts";

export interface MastershopOrderSnapshot {
    id: string;
    externalId: string;
    providerStatus: string | null;
    trackingNumber: string | null;
    carrier: string | null;
}

// Minimal shape shared by order_items rows and freshly priced checkout items.
interface CodItem {
    name: string;
    quantity: number;
    unit_price_cop: number;
    unit_shipping_cop: number;
    source: string;
    supplier_variant: Record<string, unknown> | null;
}

const SUBMITTING_STALE_MS = 2 * 60 * 1000;
const MAX_CONCURRENT_READS = 3;
// Overall budget for the live pre-submit validation — not per product.
const VALIDATION_BUDGET_MS = 45_000;
const MAX_INT32 = 2_147_483_647;

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

function boundedText(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > max) return null;
    return trimmed;
}

export function mastershopExternalId(orderId: string): string {
    return `HON-${orderId}`;
}

// ---------------------------------------------------------------------------
// Lookup / normalization
// ---------------------------------------------------------------------------

// Extracts only the fields we need — the response carries customer PII we
// must never log or persist wholesale.
function normalizeOrderResponse(raw: unknown, expectedExternalId: string): MastershopOrderSnapshot | null {
    if (!isPlainObject(raw)) return null;
    const id =
        typeof raw.idOrder === "number" && Number.isSafeInteger(raw.idOrder) && raw.idOrder > 0
            ? String(raw.idOrder)
            : isValidMastershopProductId(raw.idOrder)
              ? (raw.idOrder as string)
              : null;
    const externalId = boundedText(raw.externalOrderId, 128);
    if (!id || externalId !== expectedExternalId) return null;
    const status = boundedText(raw.status ?? raw.orderStatus, 64);
    const logistics = isPlainObject(raw.orderLogistics) ? raw.orderLogistics : null;
    const tracking = isPlainObject(logistics?.carrierTracking) ? logistics.carrierTracking : null;
    const trackingNumber = boundedText(raw.carrierTrackingCode, 64) ?? boundedText(tracking?.guide, 64);
    const carrier = boundedText(raw.carrierName, 80) ?? boundedText(logistics?.carrierName, 80);
    return { id, externalId, providerStatus: status, trackingNumber, carrier };
}

export async function lookupMastershopOrder(
    externalId: string,
    fetchImpl?: FetchLike
): Promise<MastershopResult<MastershopOrderSnapshot | null>> {
    const result = await mastershopRequest(
        `/api/orders?externalOrderId=${encodeURIComponent(externalId)}`,
        { method: "GET" },
        fetchImpl
    );
    if (!result.ok) {
        if (result.status === 404) return { ok: true, data: null };
        return { ok: false, error: result.error, status: result.status };
    }
    // The documented shape for a hit is the single order object.
    const snapshot = normalizeOrderResponse(result.data, externalId);
    if (!snapshot) {
        return { ok: false, error: "Mastershop devolvió una respuesta inesperada." };
    }
    return { ok: true, data: snapshot };
}

// ---------------------------------------------------------------------------
// Payload construction
// ---------------------------------------------------------------------------

// The documented contract accepts Unicode letters and spaces only for names.
const NAME_PATTERN = /^[\p{L}][\p{L} ]*$/u;
const CC_PATTERN = /^\d{4,20}$/;
const PHONE_PATTERN = /^\d{10,15}$/;

function normText(value: string | null | undefined): string {
    return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function codCustomerFromOrder(order: OrderRow): OrderCustomer {
    return {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
        cedula: order.customer_cedula,
        address: order.address,
        city: order.city,
        department: order.department,
        notes: order.notes,
    };
}

// Single COD customer contract shared by the checkout route and the provider
// payload builder — same bounds, same messages, NFC+space normalization.
export function validateMastershopCodCustomer(customer: OrderCustomer): string | null {
    const name = normText(customer.name);
    if (name.length === 0 || name.length > 120 || !NAME_PATTERN.test(name)) {
        return "El nombre del destinatario no es válido para contraentrega.";
    }
    const department = normText(customer.department);
    if (department.length < 3 || department.length > 60) {
        return "El departamento es obligatorio para pedidos contraentrega.";
    }
    const city = normText(customer.city);
    if (city.length === 0 || city.length > 60) {
        return "La ciudad es obligatoria para pedidos contraentrega.";
    }
    const address = normText(customer.address);
    if (address.length === 0 || address.length > 200) {
        return "La dirección del pedido está incompleta.";
    }
    const phone = customer.phone.replace(/\D/g, "");
    if (!PHONE_PATTERN.test(phone)) {
        return "El teléfono debe tener entre 10 y 15 dígitos para contraentrega.";
    }
    const cedula = customer.cedula.replace(/[.\s-]/g, "");
    if (!CC_PATTERN.test(cedula)) {
        return "Contraentrega solo admite cédula de ciudadanía numérica (CC).";
    }
    return null;
}

function splitCustomerName(full: string): { first: string; last: string | null } | null {
    const normalized = normText(full);
    if (!NAME_PATTERN.test(normalized) || normalized.length > 120) return null;
    const parts = normalized.split(" ");
    return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

function mastershopWeight(variant: Record<string, unknown>): number | null {
    const w = variant.mastershop_weight;
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > 1e6) return null;
    return w;
}

export function buildMastershopCodPayload(
    order: OrderRow,
    items: OrderItemRow[]
): { payload: Record<string, unknown> } | { error: string } {
    if (order.payment_method !== "cash_on_delivery") return { error: "El pedido no es contraentrega." };
    if (items.length === 0 || items.length > 20) return { error: "El pedido no tiene ítems válidos." };
    if ((order.discount_cop ?? 0) !== 0 || order.coupon_code) {
        return { error: "Contraentrega no admite cupones ni descuentos." };
    }

    let subtotal = 0;
    let shipping = 0;
    for (const i of items) {
        if (i.source !== "mastershop") {
            return { error: "Contraentrega solo está disponible para pedidos 100% Mastershop." };
        }
        if (!Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 20) {
            return { error: "La cantidad de un ítem del pedido no es válida." };
        }
        if (!Number.isSafeInteger(i.unit_price_cop) || i.unit_price_cop <= 0) {
            return { error: "El precio de un ítem del pedido no es válido." };
        }
        if (!Number.isSafeInteger(i.unit_shipping_cop) || i.unit_shipping_cop < 0) {
            return { error: "El envío de un ítem del pedido no es válido." };
        }
        subtotal += i.unit_price_cop * i.quantity;
        shipping += i.unit_shipping_cop * i.quantity;
        if (subtotal > MAX_INT32 || shipping > MAX_INT32) {
            return { error: "Los totales del pedido exceden el límite admitido." };
        }
    }
    if (subtotal !== order.subtotal_cop || shipping !== order.shipping_cop || subtotal + shipping !== order.total_cop) {
        return { error: "Los totales del pedido no coinciden con sus ítems." };
    }

    const customerError = validateMastershopCodCustomer(codCustomerFromOrder(order));
    if (customerError) return { error: customerError };
    const names = splitCustomerName(order.customer_name);
    if (!names) return { error: "El nombre del destinatario no es válido para el proveedor." };
    const department = normText(order.department);
    const phone = order.customer_phone.replace(/\D/g, "");
    const cedula = order.customer_cedula.replace(/[.\s-]/g, "");
    const city = normText(order.city);
    const address1 = normText(order.address);

    const orderItems: Record<string, unknown>[] = [];
    for (const i of items) {
        const v = i.supplier_variant;
        if (!isPlainObject(v)) return { error: `«${i.name}» no tiene variante de proveedor registrada.` };
        const productId = isValidMastershopProductId(v.product_id) ? (v.product_id as string) : null;
        if (!productId) return { error: `«${i.name}» no tiene un producto Mastershop válido.` };
        const variationId =
            v.variation_id === "simple"
                ? null
                : isValidMastershopProductId(v.variation_id)
                  ? (v.variation_id as string)
                  : null;
        if (variationId === null && v.variation_id !== "simple") {
            return { error: `«${i.name}» tiene una variante de proveedor inválida.` };
        }
        const weight = mastershopWeight(v);
        if (weight === null) {
            return {
                error: `«${i.name}» no tiene el peso requerido por Mastershop; regístralo en el borrador del producto.`,
            };
        }
        orderItems.push({
            id_product: Number(productId),
            id_variant: variationId === null ? null : Number(variationId),
            quantity: i.quantity,
            sku: boundedText(v.sku, 80),
            name: i.name.slice(0, 200),
            weight,
            price: i.unit_price_cop,
        });
    }

    const address = {
        zip: null,
        country: "CO",
        city,
        address1,
        address2: null,
        full_name: normText(order.customer_name),
        first_name: names.first,
        last_name: names.last,
        phone,
        company: null,
        state: department,
    };

    return {
        payload: {
            id_order: mastershopExternalId(order.id),
            shipping_address: address,
            billing_address: address,
            order_transaction: {
                total: order.total_cop,
                currency: "COP",
                payment_method: "cod",
                payment_gateway: "Honesty",
            },
            customer: {
                full_name: normText(order.customer_name),
                first_name: names.first,
                last_name: names.last,
                phone,
                email: order.customer_email,
                documentType: "CC",
                documentNumber: cedula,
                tags: [],
            },
            order_items: orderItems,
            additional_charge:
                order.shipping_cop > 0 ? [{ type_charge: "shipping", value: order.shipping_cop }] : [],
            notes: order.notes ? [order.notes.slice(0, 500)] : [],
            tags: ["Honesty"],
        },
    };
}

// ---------------------------------------------------------------------------
// Pre-submit validation against live provider data
// ---------------------------------------------------------------------------

// Validates every item against the authenticated provider: account membership,
// current variant existence, current stock and a present COP price. Two local
// catalog rows mapping to the same provider variant are aggregated so they
// cannot oversell it. No provider writes happen here.
export async function validateMastershopCodItems(
    items: CodItem[],
    fetchImpl?: FetchLike,
    opts?: { deadlineMs?: number }
): Promise<{ ok: true } | { error: string }> {
    if (items.length === 0 || items.length > 20) return { error: "El pedido no tiene ítems válidos." };
    const deadline = opts?.deadlineMs ?? Date.now() + VALIDATION_BUDGET_MS;

    const required = new Map<string, { variantId: string; quantity: number }>();
    for (const i of items) {
        if (i.source !== "mastershop") {
            return { error: "Contraentrega solo está disponible para pedidos 100% Mastershop." };
        }
        if (!Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 20) {
            return { error: "La cantidad de un ítem del pedido no es válida." };
        }
        if (!Number.isSafeInteger(i.unit_price_cop) || i.unit_price_cop <= 0) {
            return { error: "El precio de un ítem del pedido no es válido." };
        }
        if (!Number.isSafeInteger(i.unit_shipping_cop) || i.unit_shipping_cop < 0) {
            return { error: "El envío de un ítem del pedido no es válido." };
        }
        const v = i.supplier_variant;
        if (!isPlainObject(v) || !isValidMastershopProductId(v.product_id)) {
            return { error: `«${i.name}» no tiene un producto Mastershop válido.` };
        }
        const variantId = typeof v.variation_id === "string" ? v.variation_id : "";
        if (variantId !== "simple" && !isValidMastershopProductId(variantId)) {
            return { error: `«${i.name}» tiene una variante de proveedor inválida.` };
        }
        if (mastershopWeight(v) === null) {
            return {
                error: `«${i.name}» no tiene el peso requerido por Mastershop; regístralo en el borrador del producto.`,
            };
        }
        const key = `${v.product_id}:${variantId}`;
        const agg = required.get(key);
        if (agg) agg.quantity += i.quantity;
        else required.set(key, { variantId, quantity: i.quantity });
    }

    const productIds = [...new Set([...required.keys()].map((k) => k.split(":")[0]))];
    for (let i = 0; i < productIds.length; i += MAX_CONCURRENT_READS) {
        if (Date.now() > deadline) {
            return { error: "La validación con el proveedor tardó demasiado; intenta de nuevo." };
        }
        const batch = productIds.slice(i, i + MAX_CONCURRENT_READS);
        const memberships = await Promise.all(
            batch.map((pid) => mastershopProductBelongsToAccount(pid, fetchImpl))
        );
        const details = await Promise.all(batch.map((pid) => getMastershopProduct(pid, fetchImpl)));
        for (let j = 0; j < batch.length; j++) {
            const pid = batch[j];
            const membership = memberships[j];
            if (!membership.ok) return { error: membership.error };
            if (!membership.data) {
                return { error: "Un producto del pedido no está en «Mis productos» de Mastershop." };
            }
            const detail = details[j];
            if ("error" in detail) return { error: detail.error };
            const product = detail.product;
            for (const key of required.keys()) {
                const [prodId, variantId] = key.split(":");
                if (prodId !== pid) continue;
                const want = required.get(key)!;
                const variant = product.variants.find((x) => x.id === variantId);
                if (!variant) {
                    return { error: "La variante registrada ya no existe en Mastershop." };
                }
                if (variant.price === null || variant.currency !== "COP") {
                    return { error: "Mastershop no reporta un precio en COP para un producto del pedido." };
                }
                if (variant.stock === null || variant.stock < want.quantity) {
                    return { error: "Mastershop no tiene stock suficiente para completar el pedido." };
                }
            }
        }
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Idempotent placement
// ---------------------------------------------------------------------------

// Monotonic CAS stamp: two workers in the same millisecond must not produce
// the same updated_at (the claim compare would then succeed for both).
function nextVersionStamp(prev: string | null | undefined): string {
    const prevMs = prev ? Date.parse(prev) : NaN;
    const floor = Number.isFinite(prevMs) ? prevMs + 1 : 0;
    return new Date(Math.max(Date.now(), floor)).toISOString();
}

async function persistSupplierState(
    service: SupabaseClientLike,
    order: OrderRow,
    fields: Record<string, unknown>
): Promise<boolean> {
    const stamp = nextVersionStamp(order.updated_at);
    const { data, error } = await service
        .from("orders")
        .update({ ...fields, updated_at: stamp })
        .eq("id", order.id)
        .eq("updated_at", order.updated_at)
        .select("id");
    if (error || !Array.isArray(data) || data.length === 0) return false;
    order.updated_at = stamp;
    return true;
}

// Attaches a remote order snapshot we confirmed exists. Never marks paid and
// never resets the local fulfillment/mastershop status — the remote state is
// then applied through the normal sync mapping so an already-advanced local
// stage or a remote Devuelta/Cancelada is preserved, not overwritten.
async function attachRemoteOrder(
    service: SupabaseClientLike,
    order: OrderRow,
    snapshot: MastershopOrderSnapshot
): Promise<{ ok: true; supplierOrderId: string; notes: string[] } | { error: string }> {
    const supplierOrderId = `mastershop:${snapshot.id}`;
    const mapped = mapMastershopRemoteStatus(snapshot.providerStatus);
    // Remote Devuelta or an unmapped status means the remote order exists but
    // cannot be treated as a plain submitted one — keep it in reconciliation.
    const unresolved =
        snapshot.providerStatus !== null && (mapped.kind === "returned" || mapped.kind === "unknown");
    const fields: Record<string, unknown> = {
        supplier_order_id: supplierOrderId,
        supplier_order_status: unresolved ? "reconciliation_required" : "submitted",
        supplier_order_error: unresolved
            ? "Mastershop reporta un estado que requiere revisión manual."
            : null,
    };
    if (!order.supplier_order_placed_at) fields.supplier_order_placed_at = new Date().toISOString();
    if (snapshot.trackingNumber) fields.tracking_number = snapshot.trackingNumber;
    if (snapshot.carrier) fields.carrier = snapshot.carrier;
    const saved = await persistSupplierState(service, order, fields);
    if (!saved) return { error: "No se pudo registrar el pedido del proveedor localmente." };
    order.supplier_order_id = supplierOrderId;
    await service.from("order_events").insert({
        order_id: order.id,
        kind: "fulfillment",
        status: order.fulfillment_status,
        label: "Pedido registrado en Mastershop",
        description: `Pedido remoto ${snapshot.id} confirmado vía consulta. Confirma el despacho en Mastershop; el recaudo COD no está liquidado.`,
    });
    // Apply the same snapshot through the sync mapping so Cancelada/Devuelta/
    // transit statuses are honored on attach — no second provider fetch.
    const applied = await applyMastershopSnapshot(service, order, snapshot);
    if ("error" in applied) return { error: applied.error };
    return {
        ok: true,
        supplierOrderId,
        notes: ["Registrado en Mastershop; confirma el despacho allí."],
    };
}

export async function placeMastershopCodOrder(
    orderId: string,
    provided?: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<
    | { ok: true; supplierOrderId: string | null; alreadyPlaced: boolean; notes: string[] }
    | { error: string }
> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data } = await service.from("orders").select("*").eq("id", orderId).maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };
    if (order.payment_method !== "cash_on_delivery") return { error: "El pedido no es contraentrega." };
    if (order.payment_status !== "cod_pending") return { error: "El pedido ya no está pendiente de contraentrega." };
    if (order.fulfillment_status === "cancelled" || order.fulfillment_status === "delivered") {
        return { error: "order is closed" };
    }
    if (order.supplier_order_status === "submitted" && order.supplier_order_id) {
        return { ok: true, supplierOrderId: order.supplier_order_id, alreadyPlaced: true, notes: [] };
    }
    if (
        order.supplier_order_status === "submitting" &&
        order.updated_at &&
        Date.now() - Date.parse(order.updated_at) < SUBMITTING_STALE_MS
    ) {
        return { error: "supplier placement already in progress" };
    }

    const attempts = order.auto_fulfill_attempts ?? 0;
    const externalId = mastershopExternalId(order.id);

    // Any previous create attempt => ambiguous remote state => GET ONLY.
    // Never POST again, not even after a 404.
    if (
        attempts > 0 ||
        order.supplier_order_status === "reconciliation_required" ||
        order.supplier_order_status === "submitting"
    ) {
        const lookup = await lookupMastershopOrder(externalId, fetchImpl);
        if (!lookup.ok) return { error: lookup.error };
        if (lookup.data === null) {
            if (order.supplier_order_status !== "reconciliation_required") {
                await persistSupplierState(service, order, { supplier_order_status: "reconciliation_required" });
            }
            return { error: "No fue posible confirmar el pedido en Mastershop; requiere revisión manual." };
        }
        // A remote ref is already recorded — the order was attached before.
        // Validate the id matches and apply the current snapshot; re-attaching
        // would emit a duplicate "Pedido registrado" event on every poll.
        if (order.supplier_order_id) {
            if (order.supplier_order_id !== `mastershop:${lookup.data.id}`) {
                return { error: "El pedido remoto no coincide con la referencia guardada; requiere revisión manual." };
            }
            const applied = await applyMastershopSnapshot(service, order, lookup.data);
            if ("error" in applied) return { error: applied.error };
            return {
                ok: true,
                supplierOrderId: order.supplier_order_id,
                alreadyPlaced: true,
                notes: ["El pedido ya estaba registrado en Mastershop; se consultó su estado actual."],
            };
        }
        const attached = await attachRemoteOrder(service, order, lookup.data);
        if ("error" in attached) return attached;
        return {
            ok: true,
            supplierOrderId: attached.supplierOrderId,
            alreadyPlaced: true,
            notes: attached.notes,
        };
    }

    // Fresh placement requires the feature gate; read-only reconciliation
    // above stays available even when the flag was turned off afterwards.
    if (!isMastershopCodEnabled()) {
        return { error: "La contraentrega Mastershop está deshabilitada en el servidor." };
    }

    const { data: itemRows, error: itemsError } = await service
        .from("order_items")
        .select("name,quantity,unit_price_cop,unit_shipping_cop,source,supplier_variant")
        .eq("order_id", orderId);
    if (itemsError) return { error: "order items unavailable" };
    const items = ((itemRows as CodItem[] | null) ?? []).map((i) => i);

    const validation = await validateMastershopCodItems(items, fetchImpl);
    if ("error" in validation) {
        await persistSupplierState(service, order, {
            supplier_order_status: "failed",
            supplier_order_error: validation.error.slice(0, 300),
        });
        return { error: validation.error };
    }

    // Build the exact provider payload BEFORE claiming: an unbuildable order
    // is marked failed without ever consuming a create attempt.
    const built = buildMastershopCodPayload(order, (itemRows as OrderItemRow[] | null) ?? []);
    if ("error" in built) {
        await persistSupplierState(service, order, {
            supplier_order_status: "failed",
            supplier_order_error: built.error.slice(0, 300),
        });
        return { error: built.error };
    }

    // Fail closed on lookup errors: only a confirmed 404 permits a POST.
    const existing = await lookupMastershopOrder(externalId, fetchImpl);
    if (!existing.ok) return { error: existing.error };
    if (existing.data) {
        const attached = await attachRemoteOrder(service, order, existing.data);
        if ("error" in attached) return attached;
        return { ok: true, supplierOrderId: attached.supplierOrderId, alreadyPlaced: true, notes: attached.notes };
    }

    // CAS-claim the submission BEFORE the remote POST so concurrent workers
    // cannot both create — even when their updated_at collides. The guard
    // re-verifies every precondition: no prior attempt, a startable status
    // and a still-pending COD order. attempts=1 marks a create attempt
    // happened — from here on every retry is GET-only.
    const claimStamp = nextVersionStamp(order.updated_at);
    const { data: claimedRows, error: claimError } = await service
        .from("orders")
        .update({
            supplier_order_status: "submitting",
            auto_fulfill_attempts: 1,
            updated_at: claimStamp,
        })
        .eq("id", order.id)
        .eq("updated_at", order.updated_at)
        .eq("auto_fulfill_attempts", 0)
        .in("supplier_order_status", ["queued", "failed"])
        .eq("payment_status", "cod_pending")
        .eq("payment_method", "cash_on_delivery")
        .select("id");
    if (claimError) return { error: claimError.message };
    if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
        return { error: "order changed during submission; retry" };
    }
    order.updated_at = claimStamp;
    order.auto_fulfill_attempts = 1;
    order.supplier_order_status = "submitting";

    const created = await mastershopRequest("/api/orders", { method: "POST", body: built.payload }, fetchImpl);
    if (!created.ok) {
        // Timeouts and 5xx mean the remote may have succeeded — reconcile.
        const ambiguous = created.status === undefined || created.status >= 500;
        await persistSupplierState(service, order, {
            supplier_order_status: ambiguous ? "reconciliation_required" : "failed",
            supplier_order_error: created.error.slice(0, 300),
        });
        return {
            error: ambiguous
                ? "No fue posible confirmar el pedido en Mastershop; requiere revisión manual."
                : created.error,
        };
    }

    const snapshot = normalizeOrderResponse(created.data, externalId);
    if (!snapshot) {
        // Response didn't prove a remote order — possibly still created.
        await persistSupplierState(service, order, {
            supplier_order_status: "reconciliation_required",
            supplier_order_error: "Respuesta del proveedor no verificable".slice(0, 300),
        });
        return { error: "No fue posible confirmar el pedido en Mastershop; requiere revisión manual." };
    }

    const attached = await attachRemoteOrder(service, order, snapshot);
    if ("error" in attached) {
        // The remote order exists but the local save failed — surface an
        // error; future retries stay GET-only via attempts>0.
        await persistSupplierState(service, order, { supplier_order_status: "reconciliation_required" });
        return { error: attached.error };
    }
    return { ok: true, supplierOrderId: attached.supplierOrderId, alreadyPlaced: false, notes: attached.notes };
}

// ---------------------------------------------------------------------------
// Tracking reconciliation (authenticated polling — no webhooks)
// ---------------------------------------------------------------------------

type RemoteMapping =
    | { kind: "fulfillment"; status: FulfillmentStatus }
    | { kind: "delivered" }
    | { kind: "cancelled" }
    | { kind: "returned" }
    | { kind: "unknown" };

// Remote status ids 2/3/4 and 5/6 collapse into the same local stages; the
// provider name strings are the documented fallbacks.
export function mapMastershopRemoteStatus(raw: string | null): RemoteMapping {
    const s = (raw ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    if (s === "1" || s === "por confirmar") return { kind: "fulfillment", status: "awaiting_confirmation" };
    if (s === "2" || s === "pendiente" || s === "3" || s === "por alistar" || s === "4" || s === "por recolectar") {
        return { kind: "fulfillment", status: "supplier_processing" };
    }
    if (s === "5" || s === "recolectada" || s === "6" || s === "en transito") {
        return { kind: "fulfillment", status: "domestic_transit" };
    }
    if (s === "8" || s === "entregada") return { kind: "delivered" };
    if (s === "9" || s === "cancelada") return { kind: "cancelled" };
    if (s === "10" || s === "devuelta") return { kind: "returned" };
    return { kind: "unknown" };
}

// COD-only transitions are forward-only on the repository's COD sequence —
// prepaid stages (payment_confirmed, international_transit, customs_cleared)
// are never reachable for a COD order.
export function canTransitionCodFulfillment(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
    return canTransitionFulfillment(from, to, true);
}

function isLocallyClosed(order: OrderRow): boolean {
    const closedPayment: PaymentStatus[] = ["cancelled", "refunded"];
    return (
        order.fulfillment_status === "cancelled" ||
        order.fulfillment_status === "delivered" ||
        closedPayment.includes(order.payment_status)
    );
}

// Applies a provider snapshot to the order: tracking fields, provider status
// and the COD status mapping with forward-only transitions. Shared by
// authenticated polling (syncMastershopTracking) and by reconciliation attach
// — the snapshot is applied once, never re-fetched.
async function applyMastershopSnapshot(
    service: SupabaseClientLike,
    order: OrderRow,
    snapshot: MastershopOrderSnapshot
): Promise<SyncOutcome | { error: string }> {
    // A locally closed order never takes remote updates — cancellation or
    // delivery proof on our side wins over a late-attach race.
    if (isLocallyClosed(order)) {
        return {
            ok: true,
            trackingNumber: order.tracking_number,
            carrier: order.carrier,
            providerStatus: snapshot.providerStatus,
            fulfillmentAdvanced: false,
        };
    }
    const now = new Date().toISOString();
    // supplier_synced_at is wall-clock; updated_at stays monotonic so an
    // attach stamp is never moved backwards by a same-millisecond sync.
    const fields: Record<string, unknown> = {
        supplier_synced_at: now,
        updated_at: nextVersionStamp(order.updated_at),
    };
    const events: { label: string; description: string; status: string; kind?: "note" }[] = [];
    let fulfillmentAdvanced = false;

    if (snapshot.providerStatus && snapshot.providerStatus !== order.mastershop_status) {
        fields.mastershop_status = snapshot.providerStatus;
    }
    const statusChanged = snapshot.providerStatus !== order.mastershop_status;

    if (snapshot.trackingNumber && order.tracking_number !== snapshot.trackingNumber) {
        fields.tracking_number = snapshot.trackingNumber;
        fields.carrier = snapshot.carrier ?? order.carrier;
        events.push({
            label: "Guía registrada",
            status: order.fulfillment_status,
            description: `${snapshot.carrier ?? "Transportadora"}: ${snapshot.trackingNumber} (sincronizado de Mastershop)`,
        });
    } else if (snapshot.carrier && !order.carrier) {
        fields.carrier = snapshot.carrier;
    }

    const mapped = mapMastershopRemoteStatus(snapshot.providerStatus);

    if (snapshot.providerStatus !== null && (mapped.kind === "returned" || mapped.kind === "unknown")) {
        // Returned/unresolved remote states latch attention even when the
        // status itself did not change between polls.
        fields.supplier_order_status = "reconciliation_required";
    } else if (snapshot.providerStatus !== null) {
        // A recognized remote state resolves prior submission ambiguity —
        // but the returned/unknown latch above can never be erased by it.
        fields.supplier_order_status = "submitted";
    }

    if (statusChanged) {
        if (mapped.kind === "fulfillment" && canTransitionCodFulfillment(order.fulfillment_status, mapped.status)) {
            fields.fulfillment_status = mapped.status;
            fulfillmentAdvanced = true;
            events.push({
                label: FULFILLMENT_STATUS_LABELS[mapped.status],
                status: mapped.status,
                description: `Mastershop reporta «${snapshot.providerStatus}».`,
            });
        } else if (mapped.kind === "cancelled") {
            // Authenticated provider proof of remote cancellation.
            fields.payment_status = "cancelled";
            fields.fulfillment_status = "cancelled";
            events.push({
                label: "Pedido cancelado en Mastershop",
                status: "cancelled",
                description: "Mastershop reportó la cancelación del pedido remoto. El estado de recaudo no se ha verificado.",
            });
        } else if (mapped.kind === "delivered") {
            // Carrier delivery ≠ COD collection. Never auto-mark paid or
            // delivered — collection/settlement is verified manually.
            events.push({
                label: "Mastershop reporta entrega",
                status: order.fulfillment_status,
                description: "Mastershop reporta entrega; recaudo sin verificar",
                kind: "note",
            });
        } else if (mapped.kind === "returned") {
            fields.supplier_order_status = "reconciliation_required";
            events.push({
                label: "Devolución reportada por Mastershop",
                status: order.fulfillment_status,
                description: "Mastershop reporta devolución; requiere reconciliación. El pedido NO se marcó como reembolsado.",
                kind: "note",
            });
        }
    }

    const { data: updated, error } = await service
        .from("orders")
        .update(fields)
        .eq("id", order.id)
        .eq("updated_at", order.updated_at)
        .select("id");
    if (error) return { error: error.message };
    if (((updated as { id: string }[] | null) ?? []).length === 0) {
        return { error: "order changed during sync; retry" };
    }
    order.updated_at = fields.updated_at as string;
    if (fields.mastershop_status) order.mastershop_status = snapshot.providerStatus;
    if (fields.fulfillment_status) order.fulfillment_status = fields.fulfillment_status as OrderRow["fulfillment_status"];
    if (fields.payment_status) order.payment_status = fields.payment_status as OrderRow["payment_status"];
    if (fields.supplier_order_status) order.supplier_order_status = fields.supplier_order_status as string;

    for (const evt of events) {
        await service.from("order_events").insert({
            order_id: order.id,
            kind: evt.kind === "note" ? "note" : "fulfillment",
            status: evt.status,
            label: evt.label,
            description: evt.description.slice(0, 500),
        });
    }

    return {
        ok: true,
        trackingNumber: (fields.tracking_number as string | undefined) ?? order.tracking_number,
        carrier: (fields.carrier as string | undefined) ?? order.carrier,
        providerStatus: snapshot.providerStatus,
        fulfillmentAdvanced,
    };
}

export async function syncMastershopTracking(
    order: OrderRow,
    provided: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<SyncOutcome | { error: string }> {
    const service = provided;
    // Guards run BEFORE any provider call: a non-COD row or a locally closed
    // order must never be reconciled or written by this path.
    if (order.payment_method !== "cash_on_delivery") {
        return { error: "El pedido no es contraentrega." };
    }
    if (isLocallyClosed(order)) {
        return { error: "order is closed" };
    }
    if (!order.supplier_order_id || !order.supplier_order_id.startsWith("mastershop:")) {
        return { error: "no mastershop supplier order" };
    }
    const storedRemoteId = order.supplier_order_id.slice("mastershop:".length);
    const externalId = mastershopExternalId(order.id);

    const lookup = await lookupMastershopOrder(externalId, fetchImpl);
    if (!lookup.ok) return { error: lookup.error };
    if (lookup.data === null) return { error: "Mastershop no encontró el pedido remoto." };
    const snapshot = lookup.data;
    if (snapshot.id !== storedRemoteId) {
        return { error: "El pedido remoto de Mastershop no coincide con el registro local." };
    }

    return applyMastershopSnapshot(service, order, snapshot);
}
