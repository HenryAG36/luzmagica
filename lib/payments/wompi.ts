import { createHash, timingSafeEqual } from "crypto";
import { getWompiEnv } from "../env.ts";
import type { FetchLike } from "../trends/http.ts";

export interface WompiPaymentLink {
    id: string;
    url: string;
}

export async function createPaymentLink(
    input: {
        name: string;
        description: string;
        amountInCents: number;
        redirectUrl: string;
        expiresAt?: string;
    },
    fetchImpl?: FetchLike
): Promise<{ ok: true; link: WompiPaymentLink } | { ok: false; error: string }> {
    const env = getWompiEnv();
    if (!env) return { ok: false, error: "wompi not configured" };
    const fetcher = fetchImpl ?? fetch;
    try {
        const res = await fetcher(`${env.baseUrl}/payment_links`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.privateKey}`,
            },
            body: JSON.stringify({
                name: input.name.slice(0, 150),
                description: input.description.slice(0, 255),
                single_use: true,
                collect_shipping: false,
                currency: "COP",
                amount_in_cents: input.amountInCents,
                redirect_url: input.redirectUrl,
                ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
            }),
        });
        const body: unknown = await res.json().catch(() => null);
        const data =
            body && typeof body === "object"
                ? (body as { data?: { id?: unknown; url?: unknown } }).data
                : null;
        if (!res.ok || typeof data?.id !== "string" || typeof data?.url !== "string") {
            const reason =
                body && typeof body === "object"
                    ? ((body as { error?: { reason?: unknown } }).error?.reason ??
                      (body as { error?: { messages?: unknown } }).error?.messages)
                    : null;
            return { ok: false, error: `payment link failed (${String(reason ?? res.status)})` };
        }
        return { ok: true, link: { id: data.id, url: data.url } };
    } catch {
        return { ok: false, error: "wompi request failed" };
    }
}

export interface WompiEventBody {
    event?: unknown;
    data?: unknown;
    signature?: { properties?: unknown; checksum?: unknown };
    timestamp?: unknown;
    sent_at?: unknown;
}

function resolvePath(obj: unknown, path: string): unknown {
    let cur = obj;
    for (const key of path.split(".")) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

// Wompi signs events as sha256(concat(values of signature.properties, in
// order) + timestamp + events_secret). Anything that fails verification is
// not a Wompi event and must be rejected before touching state.
export function verifyEventChecksum(body: WompiEventBody, secret: string): boolean {
    const properties = body.signature?.properties;
    const checksum = body.signature?.checksum;
    const timestamp = body.timestamp;
    if (!Array.isArray(properties) || typeof checksum !== "string" || timestamp === undefined || timestamp === null) {
        return false;
    }
    const values: string[] = [];
    for (const prop of properties) {
        if (typeof prop !== "string") return false;
        const value = resolvePath(body.data, prop);
        if (value === undefined || value === null) return false;
        values.push(String(value));
    }
    const computed = createHash("sha256")
        .update(values.join("") + String(timestamp) + secret, "utf8")
        .digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(checksum.toLowerCase(), "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
}

export interface WompiTransactionInfo {
    id: string;
    status: string;
    amountInCents: number | null;
    paymentLinkId: string | null;
}

export function extractTransaction(body: WompiEventBody): WompiTransactionInfo | null {
    const data = body.data;
    if (!data || typeof data !== "object") return null;
    const tx = (data as Record<string, unknown>).transaction;
    if (!tx || typeof tx !== "object") return null;
    const t = tx as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.status !== "string") return null;
    return {
        id: t.id,
        status: t.status,
        amountInCents: typeof t.amount_in_cents === "number" ? t.amount_in_cents : null,
        paymentLinkId: typeof t.payment_link_id === "string" ? t.payment_link_id : null,
    };
}
