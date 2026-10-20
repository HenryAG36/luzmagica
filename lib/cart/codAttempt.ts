// COD checkout-attempt id management for the browser. One idempotent attempt
// id per checkout request: a retry after a lost response must reuse the SAME
// id (the server binds it to the order), while a changed payload gets a fresh
// one. The id is stable in this order: in-memory map (same session, survives
// storage errors) → sessionStorage → freshly generated.
//
// Security notes:
// - The canonical payload is hashed (SHA-256) before touching storage — no
//   customer PII is ever written to sessionStorage.
// - crypto.subtle is required. If it is unavailable the checkout fails
//   visibly before any POST instead of silently degrading.
// - The in-memory map only covers the mounted runtime. Reload recovery needs
//   working sessionStorage; without it a reload mints a NEW attempt id and
//   the server treats the retry as a different checkout. There is no
//   plaintext fallback — PII is never written to storage.

import { normalizePhone } from "../orders/validate.ts";

export interface CodAttemptCustomer {
    name: string;
    email: string;
    phone: string;
    cedula: string;
    address: string;
    city: string;
    department?: string | null;
    notes?: string | null;
}

export interface CodAttemptItem {
    productId: string;
    quantity: number;
}

export interface CodAttemptInput {
    customer: CodAttemptCustomer;
    items: CodAttemptItem[];
}

const STORAGE_KEY = "honesty-cod-attempt";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Survives storage failures and page remounts within the session.
const attemptIds = new Map<string, string>();

function norm(value: string | null | undefined): string {
    // Same normalization the server sanitizer applies so cosmetic edits do
    // not mint a new attempt id.
    return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function canonicalRequest(input: CodAttemptInput): string {
    return JSON.stringify({
        m: "cash_on_delivery",
        c: {
            n: norm(input.customer.name),
            // Same normalizations the server fingerprint applies so equivalent
            // inputs (email case, phone formatting) map to one attempt.
            e: norm(input.customer.email).toLowerCase(),
            p: normalizePhone(norm(input.customer.phone)),
            d: norm(input.customer.cedula),
            a: norm(input.customer.address),
            ci: norm(input.customer.city),
            de: norm(input.customer.department ?? null),
            no: norm(input.customer.notes ?? null),
        },
        i: input.items
            .map((i) => ({ p: norm(i.productId), q: i.quantity }))
            .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)),
    });
}

async function sha256Hex(text: string): Promise<string | null> {
    try {
        if (!globalThis.crypto?.subtle) return null;
        const digest = await globalThis.crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(text)
        );
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    } catch {
        return null;
    }
}

export async function codAttemptId(
    input: CodAttemptInput
): Promise<{ attemptId: string } | { error: string }> {
    const fingerprint = await sha256Hex(canonicalRequest(input));
    if (!fingerprint) {
        return {
            error: "Este navegador no soporta la verificación segura del pedido contraentrega; usa pago en línea o intenta en otro navegador.",
        };
    }

    const inMemory = attemptIds.get(fingerprint);
    if (inMemory) return { attemptId: inMemory };

    try {
        const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
        if (stored && stored.f === fingerprint && UUID_PATTERN.test(stored.a)) {
            attemptIds.set(fingerprint, stored.a as string);
            return { attemptId: stored.a as string };
        }
    } catch {
        // Storage unavailable — the in-memory map still covers this mounted
        // checkout, but a reload would mint a new attempt id.
    }

    let fresh: string;
    try {
        fresh = globalThis.crypto.randomUUID();
    } catch {
        return {
            error: "Este navegador no soporta la verificación segura del pedido contraentrega; usa pago en línea o intenta en otro navegador.",
        };
    }
    attemptIds.set(fingerprint, fresh);
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ f: fingerprint, a: fresh }));
    } catch {
        // Best-effort persistence only — the in-memory map keeps this session
        // stable, but recovery after a reload requires working storage.
    }
    return { attemptId: fresh };
}

// Test seam — production code never calls this.
export function __resetCodAttemptsForTests(): void {
    attemptIds.clear();
}
