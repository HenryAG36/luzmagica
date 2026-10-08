import { randomUUID } from "crypto";
import type { SupabaseClientLike } from "../supabase/types.ts";
import type { ClaimReason, ClaimStatus, OrderItemRow, OrderRow, SupplierClaimRow } from "./types.ts";
import { CLAIM_REASONS } from "./types.ts";
import { orderMatchesContact, SUPPLIER_SOURCES } from "./repository.ts";

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

export const CLAIM_EVIDENCE_BUCKET = "claim-evidence";
export const MAX_EVIDENCE_FILES = 3;
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "mp4", "mov", "webm"]);

const CLAIMABLE_FULFILLMENT = new Set([
    "international_transit",
    "customs_cleared",
    "local_delivery",
    "delivered",
]);

// Minimal storage surface — the real SupabaseClient implements this; the
// test fake does not, so tests inject EvidenceUploader/signer instead.
export interface StorageLike {
    from(bucket: string): {
        upload(path: string, bytes: ArrayBuffer, opts: { contentType: string }): Promise<{ error: { message: string } | null }>;
        createSignedUrls(paths: string[], seconds: number): Promise<{ data?: { signedUrl?: string }[] | null; error?: { message: string } | null }>;
    };
}

// Injected so tests can exercise claim logic without storage.
export type EvidenceUploader = (
    path: string,
    file: { bytes: ArrayBuffer; contentType: string }
) => Promise<{ ok: true } | { error: string }>;

function defaultUploader(service: SupabaseClientLike): EvidenceUploader {
    return async (path, file) => {
        const storage = (service as unknown as { storage?: StorageLike }).storage;
        if (!storage) return { error: "storage unavailable" };
        const { error } = await storage
            .from(CLAIM_EVIDENCE_BUCKET)
            .upload(path, file.bytes, { contentType: file.contentType });
        if (error) return { error: error.message };
        return { ok: true };
    };
}

export function validateEvidenceFile(
    fileName: string,
    size: number
): { ok: true; ext: string } | { error: string } {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(ext)) return { error: "file type not allowed" };
    if (size <= 0 || size > MAX_EVIDENCE_BYTES) return { error: "file size not allowed" };
    return { ok: true, ext };
}

// Customer claim gate mirrors order lookup: ref + contact (or the
// unguessable lookup token) prove ownership. Claims are only valid once
// the order is paid and past dispatch (or 'not_received' mid-transit).
export async function submitCustomerClaim(
    input: {
        ref: string;
        contact?: string | null;
        token?: string | null;
        productId: string;
        reason: string;
        description: string;
        files: { name: string; type: string; bytes: ArrayBuffer }[];
    },
    provided?: SupabaseClientLike,
    uploader?: EvidenceUploader
): Promise<{ ok: true; claimId: string } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    if (!CLAIM_REASONS.includes(input.reason as ClaimReason)) return { error: "invalid reason" };
    const description = input.description.trim();
    if (description.length < 10 || description.length > 2000) {
        return { error: "invalid description" };
    }
    if (input.files.length > MAX_EVIDENCE_FILES) return { error: "too many files" };
    for (const f of input.files) {
        const v = validateEvidenceFile(f.name, f.bytes.byteLength);
        if ("error" in v) return { error: `${f.name}: ${v.error}` };
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

    if (order.payment_status !== "paid" || !CLAIMABLE_FULFILLMENT.has(order.fulfillment_status)) {
        return { error: "order is not claimable" };
    }

    const { data: itemRows } = await service.from("order_items").select("*").eq("order_id", order.id);
    const items = (itemRows as OrderItemRow[] | null) ?? [];
    const item = items.find((i) => i.product_id === input.productId);
    if (!item) return { error: "product not in this order" };

    const claimId = randomUUID();
    const provider = SUPPLIER_SOURCES.has(item.source)
        ? (item.source as "aliexpress_ds" | "cjdropshipping")
        : "manual";

    const upload = uploader ?? defaultUploader(service);
    const evidencePaths: string[] = [];
    for (const [i, f] of input.files.entries()) {
        const v = validateEvidenceFile(f.name, f.bytes.byteLength);
        if ("error" in v) continue;
        const path = `${order.id}/${claimId}/${i}.${v.ext}`;
        const result = await upload(path, { bytes: f.bytes, contentType: f.type || "application/octet-stream" });
        if ("error" in result) return { error: `evidence upload failed: ${result.error}` };
        evidencePaths.push(path);
    }

    const now = new Date().toISOString();
    const { error } = await service.from("supplier_claims").insert({
        id: claimId,
        order_id: order.id,
        order_item_id: item.id,
        provider,
        reason: input.reason,
        description,
        evidence_paths: evidencePaths,
        status: "draft",
        created_by: "customer",
        created_at: now,
        updated_at: now,
    });
    if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
            return { error: "claim already exists" };
        }
        return { error: error.message };
    }

    await service.from("order_events").insert({
        order_id: order.id,
        kind: "note",
        status: order.fulfillment_status,
        label: "Reclamo de cliente",
        description: `Motivo: ${input.reason}. Producto: ${item.name}.`.slice(0, 500),
    });
    return { ok: true, claimId };
}

// ---------- admin ----------

export interface AdminClaimRow extends SupplierClaimRow {
    order_ref: string | null;
    product_name: string | null;
    customer_name: string | null;
    supplier_order_id: string | null;
}

export async function listClaimsForAdmin(
    status: ClaimStatus | undefined,
    provided?: SupabaseClientLike
): Promise<{ claims: AdminClaimRow[] } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    let query = service.from("supplier_claims").select("*").order("created_at").limit(200);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    const claims = ((data as SupplierClaimRow[] | null) ?? []).reverse();

    const orderIds = [...new Set(claims.map((c) => c.order_id))];
    const itemIds = claims.map((c) => c.order_item_id);
    const [{ data: orderRows }, { data: itemRows }] = await Promise.all([
        orderIds.length
            ? service.from("orders").select("id,ref,customer_name,supplier_order_id").in("id", orderIds)
            : Promise.resolve({ data: [] }),
        itemIds.length
            ? service.from("order_items").select("id,name,product_id").in("id", itemIds)
            : Promise.resolve({ data: [] }),
    ]);
    const orderById = new Map(
        ((orderRows as { id: string; ref: string; customer_name: string; supplier_order_id: string | null }[] | null) ?? []).map(
            (o) => [o.id, o]
        )
    );
    const itemById = new Map(
        ((itemRows as { id: number; name: string; product_id: string }[] | null) ?? []).map((i) => [i.id, i])
    );

    return {
        claims: claims.map((c) => ({
            ...c,
            order_ref: orderById.get(c.order_id)?.ref ?? null,
            customer_name: orderById.get(c.order_id)?.customer_name ?? null,
            supplier_order_id: orderById.get(c.order_id)?.supplier_order_id ?? null,
            product_name: itemById.get(c.order_item_id)?.name ?? null,
        })),
    };
}

export async function updateClaimAdmin(
    id: string,
    input: { status?: ClaimStatus; notes?: string; providerDisputeId?: string; providerStatus?: string },
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.status) fields.status = input.status;
    if (input.notes !== undefined) fields.notes = input.notes.slice(0, 1000);
    if (input.providerDisputeId !== undefined) fields.provider_dispute_id = input.providerDisputeId;
    if (input.providerStatus !== undefined) fields.provider_status = input.providerStatus;
    const { data, error } = await service
        .from("supplier_claims")
        .update(fields)
        .eq("id", id)
        .select("id");
    if (error) return { error: error.message };
    if (((data as { id: string }[] | null) ?? []).length === 0) {
        return { error: "claim not found" };
    }
    return { ok: true };
}

export async function getClaimForAdmin(
    id: string,
    provided?: SupabaseClientLike
): Promise<{ claim: AdminClaimRow } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data } = await service.from("supplier_claims").select("*").eq("id", id).maybeSingle();
    const claim = (data as SupplierClaimRow | null) ?? null;
    if (!claim) return { error: "claim not found" };
    const [{ data: orderRows }, { data: itemRows }] = await Promise.all([
        service.from("orders").select("id,ref,customer_name,supplier_order_id").eq("id", claim.order_id),
        service.from("order_items").select("id,name,product_id").eq("id", claim.order_item_id),
    ]);
    const order = ((orderRows as { id: string; ref: string; customer_name: string; supplier_order_id: string | null }[] | null) ?? [])[0];
    const item = ((itemRows as { id: number; name: string; product_id: string }[] | null) ?? [])[0];
    return {
        claim: {
            ...claim,
            order_ref: order?.ref ?? null,
            customer_name: order?.customer_name ?? null,
            supplier_order_id: order?.supplier_order_id ?? null,
            product_name: item?.name ?? null,
        },
    };
}

// Short-lived signed URLs so the operator can view private-bucket evidence.
export async function getClaimEvidenceUrls(
    claimId: string,
    provided?: SupabaseClientLike,
    signer?: (paths: string[]) => Promise<{ urls: string[] } | { error: string }>
): Promise<{ urls: string[] } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data } = await service
        .from("supplier_claims")
        .select("evidence_paths")
        .eq("id", claimId)
        .maybeSingle();
    const claim = (data as Pick<SupplierClaimRow, "evidence_paths"> | null) ?? null;
    if (!claim) return { error: "claim not found" };
    if (claim.evidence_paths.length === 0) return { urls: [] };

    if (signer) return signer(claim.evidence_paths);
    const storage = (service as unknown as { storage?: StorageLike }).storage;
    if (!storage) return { error: "storage unavailable" };
    const { data: signed, error } = await storage
        .from(CLAIM_EVIDENCE_BUCKET)
        .createSignedUrls(claim.evidence_paths, 300);
    if (error) return { error: error.message };
    const urls = (signed ?? [])
        .map((s) => s.signedUrl)
        .filter((u): u is string => typeof u === "string");
    return { urls };
}

// Operator-side attachment (evidence gathered over WhatsApp/email).
export async function attachClaimEvidence(
    claimId: string,
    files: { name: string; type: string; bytes: ArrayBuffer }[],
    provided?: SupabaseClientLike,
    uploader?: EvidenceUploader
): Promise<{ ok: true; count: number } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };
    const { data } = await service
        .from("supplier_claims")
        .select("*")
        .eq("id", claimId)
        .maybeSingle();
    const claim = (data as SupplierClaimRow | null) ?? null;
    if (!claim) return { error: "claim not found" };
    if (claim.evidence_paths.length + files.length > MAX_EVIDENCE_FILES + 3) {
        return { error: "too many files" };
    }
    const upload = uploader ?? defaultUploader(service);
    const paths = [...claim.evidence_paths];
    for (const f of files) {
        const v = validateEvidenceFile(f.name, f.bytes.byteLength);
        if ("error" in v) return { error: `${f.name}: ${v.error}` };
        const path = `${claim.order_id}/${claim.id}/${paths.length}.${v.ext}`;
        const result = await upload(path, { bytes: f.bytes, contentType: f.type || "application/octet-stream" });
        if ("error" in result) return { error: `evidence upload failed: ${result.error}` };
        paths.push(path);
    }
    const { error } = await service
        .from("supplier_claims")
        .update({ evidence_paths: paths, updated_at: new Date().toISOString() })
        .eq("id", claimId);
    if (error) return { error: error.message };
    return { ok: true, count: paths.length };
}
