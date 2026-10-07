import { isPlainObject } from "../catalog/validate.ts";
import type { OrderCustomer, OrderItemInput } from "./types.ts";

const MAX_ITEMS = 20;
const MAX_QTY_PER_ITEM = 20;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function bounded(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function optionalBounded(value: unknown, max: number): string | null | undefined {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length <= max ? trimmed : undefined;
}

export function normalizePhone(value: string): string {
    return value.replace(/\D/g, "");
}

export interface SanitizedOrderInput {
    customer: OrderCustomer;
    items: OrderItemInput[];
    couponCode: string | null;
}

export function sanitizeOrderInput(
    body: unknown
): { ok: true; input: SanitizedOrderInput } | { ok: false; error: string } {
    if (!isPlainObject(body)) return { ok: false, error: "invalid body" };
    if (body.consent !== true) {
        return { ok: false, error: "Se requiere aceptar la política de tratamiento de datos." };
    }

    const rawCustomer = isPlainObject(body.customer) ? body.customer : null;
    if (!rawCustomer) return { ok: false, error: "customer required" };

    const name = bounded(rawCustomer.name, 120);
    const email = bounded(rawCustomer.email, 254);
    const phoneRaw = bounded(rawCustomer.phone, 32);
    const cedula = bounded(rawCustomer.cedula, 20);
    const address = bounded(rawCustomer.address, 200);
    const city = bounded(rawCustomer.city, 80);
    const department = optionalBounded(rawCustomer.department, 80);
    const notes = optionalBounded(rawCustomer.notes, 500);

    if (!name) return { ok: false, error: "Nombre inválido." };
    if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "Email inválido." };
    const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
    if (phone.length < 7 || phone.length > 15) return { ok: false, error: "Teléfono inválido." };
    if (!cedula || !/^[0-9A-Za-z.-]{4,20}$/.test(cedula)) {
        return { ok: false, error: "Documento inválido." };
    }
    if (!address || address.length < 5) return { ok: false, error: "Dirección inválida." };
    if (!city) return { ok: false, error: "Ciudad inválida." };
    if (department === undefined) return { ok: false, error: "Departamento inválido." };
    if (notes === undefined) return { ok: false, error: "Notas inválidas." };

    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
        return { ok: false, error: "items required" };
    }
    const merged = new Map<string, number>();
    for (const raw of body.items) {
        if (!isPlainObject(raw)) return { ok: false, error: "invalid item" };
        const productId = raw.productId;
        const quantity = raw.quantity;
        if (typeof productId !== "string" || !PRODUCT_ID_PATTERN.test(productId)) {
            return { ok: false, error: "invalid product id" };
        }
        if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QTY_PER_ITEM) {
            return { ok: false, error: "invalid quantity" };
        }
        merged.set(productId, (merged.get(productId) ?? 0) + (quantity as number));
        if (merged.get(productId)! > MAX_QTY_PER_ITEM) {
            return { ok: false, error: "invalid quantity" };
        }
    }
    const items = [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));

    const couponCode =
        typeof body.couponCode === "string" && body.couponCode.trim() !== ""
            ? body.couponCode.trim().toUpperCase().slice(0, 32)
            : null;

    return {
        ok: true,
        input: {
            customer: { name, email: email.toLowerCase(), phone, cedula, address, city, department, notes },
            items,
            couponCode,
        },
    };
}

export function sanitizeOrderLookup(body: unknown): { ref: string; contact: string } | null {
    if (!isPlainObject(body)) return null;
    const ref = bounded(body.ref, 32);
    const contact = bounded(body.contact, 254);
    if (!ref || !contact) return null;
    return { ref: ref.toUpperCase(), contact };
}

export function sanitizeOrderStatusQuery(body: unknown): { ref: string; token: string } | null {
    if (!isPlainObject(body)) return null;
    const ref = bounded(body.ref, 32);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!ref || !/^[0-9a-f]{64}$/.test(token)) return null;
    return { ref: ref.toUpperCase(), token };
}
