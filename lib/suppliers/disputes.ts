import type { SupabaseClientLike } from "../supabase/types.ts";
import type { FetchLike } from "../trends/http.ts";
import type { OrderItemRow, OrderRow, SupplierClaimRow } from "../orders/types.ts";
import { CLAIM_REASON_LABELS } from "../orders/types.ts";
import { updateClaimAdmin, CLAIM_EVIDENCE_BUCKET, type StorageLike } from "../orders/claims.ts";
import { parseSupplierRefs } from "./tracking.ts";
import {
    createCjDispute,
    fetchCjDisputeConfirmInfo,
    fetchCjDisputeProducts,
    getCjAccessToken,
    uploadCjDisputeFile,
    type CjDisputeReason,
} from "./cjdropshipping.ts";

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

// CJ returns the valid reasons per order via disputeConfirmInfo — we pick
// the closest match to the claim's reason rather than guessing ids.
export function pickCjDisputeReasonId(
    reasons: CjDisputeReason[],
    claimReason: SupplierClaimRow["reason"]
): CjDisputeReason | null {
    const patterns: Record<SupplierClaimRow["reason"], RegExp> = {
        defective: /defect|quality|not work|fault/i,
        damaged: /damag|broken|scratch/i,
        wrong_item: /wrong|incorrect|mismatch|different/i,
        not_received: /not received|non.?delivery|not arrived|missing/i,
        other: /.*/,
    };
    const pattern = patterns[claimReason];
    return reasons.find((r) => pattern.test(r.reasonName)) ?? (claimReason === "other" ? reasons[0] ?? null : null);
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

export interface ClaimSubmitOutcome {
    ok: true;
    disputeId: string | null;
}

// Files a customer claim as a CJ dispute. Steps follow the documented flow:
// eligible products -> confirm info (valid reason ids) -> copy evidence to
// CJ's CDN -> create. businessDisputeId is our claim id, so retries never
// duplicate the dispute. Only draft claims can be submitted — the operator
// confirms every filing.
export async function submitCjDispute(
    claimId: string,
    provided?: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<ClaimSubmitOutcome | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data } = await service.from("supplier_claims").select("*").eq("id", claimId).maybeSingle();
    const claim = (data as SupplierClaimRow | null) ?? null;
    if (!claim) return { error: "claim not found" };
    if (claim.provider !== "cjdropshipping") return { error: "not a cj claim" };
    if (claim.status !== "draft") return { error: "claim already handled" };

    const { data: orderData } = await service
        .from("orders")
        .select("*")
        .eq("id", claim.order_id)
        .maybeSingle();
    const order = (orderData as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };

    const { data: itemData } = await service
        .from("order_items")
        .select("*")
        .eq("id", claim.order_item_id)
        .maybeSingle();
    const item = (itemData as OrderItemRow | null) ?? null;
    if (!item) return { error: "order item not found" };

    const refs = parseSupplierRefs(order.supplier_order_id);
    if (!refs.cj || refs.cj === "submitted") {
        return { error: "no CJ order reference on this order" };
    }

    const token = await getCjAccessToken(service, fetchImpl);
    if ("error" in token) return { error: `CJ Dropshipping: ${token.error}` };

    const products = await fetchCjDisputeProducts(token.token, refs.cj, fetchImpl);
    if (!products.ok || !products.data) {
        return { error: `CJ Dropshipping: ${products.error ?? "dispute products failed"}` };
    }
    const cjPid = item.product_id.replace(/^cjdropshipping-/, "");
    const target =
        products.data.find((p) => p.cjProductId === cjPid && p.canChoose) ??
        products.data.find((p) => p.canChoose);
    if (!target) {
        return { error: "CJ: el ítem no es elegible para disputa (canChoose=false o no encontrado)" };
    }

    const confirm = await fetchCjDisputeConfirmInfo(
        token.token,
        refs.cj,
        [{ lineItemId: target.lineItemId, quantity: item.quantity, price: target.price ?? 0 }],
        fetchImpl
    );
    if (!confirm.ok || !confirm.data) {
        return { error: `CJ Dropshipping: ${confirm.error ?? "dispute confirm failed"}` };
    }
    const reason = pickCjDisputeReasonId(confirm.data.reasons, claim.reason);
    if (!reason) {
        const available = confirm.data.reasons.map((r) => r.reasonName).join(", ");
        return {
            error: `CJ: ninguna razón coincide con "${CLAIM_REASON_LABELS[claim.reason]}". Disponibles: ${available || "ninguna"}`,
        };
    }

    // Evidence: mint short-lived signed URLs (private bucket) — CJ copies the
    // bytes synchronously, so expiry is fine.
    const storage = (service as unknown as { storage?: StorageLike }).storage;
    const imageUrls: string[] = [];
    const videoUrls: string[] = [];
    if (claim.evidence_paths.length > 0) {
        if (!storage) return { error: "storage unavailable" };
        const { data: signed, error: signError } = await storage
            .from(CLAIM_EVIDENCE_BUCKET)
            .createSignedUrls(claim.evidence_paths, 300);
        if (signError) return { error: `evidence signing failed: ${signError.message}` };
        for (const [i, s] of (signed ?? []).entries()) {
            if (!s.signedUrl) continue;
            const uploaded = await uploadCjDisputeFile(token.token, s.signedUrl, fetchImpl);
            if (!uploaded.ok || !uploaded.data) {
                return { error: `CJ evidence upload: ${uploaded.error ?? "failed"}` };
            }
            const isVideo =
                uploaded.data.fileType === "VIDEO" ||
                VIDEO_EXTENSIONS.has(claim.evidence_paths[i]?.split(".").pop() ?? "");
            (isVideo ? videoUrls : imageUrls).push(uploaded.data.url);
        }
    }

    const created = await createCjDispute(
        token.token,
        {
            orderId: refs.cj,
            businessDisputeId: claim.id,
            disputeReasonId: reason.disputeReasonId,
            messageText: `${order.ref} — ${CLAIM_REASON_LABELS[claim.reason]}: ${claim.description}`,
            imageUrls,
            videoUrls,
            products: [
                { lineItemId: target.lineItemId, quantity: item.quantity, price: target.price ?? 0 },
            ],
        },
        fetchImpl
    );
    if (!created.ok) {
        return { error: `CJ Dropshipping: ${created.error ?? "dispute rejected"}` };
    }

    const updated = await updateClaimAdmin(
        claimId,
        { status: "submitted", providerDisputeId: claim.id, providerStatus: "CJ: disputa creada" },
        service
    );
    if ("error" in updated) return { error: updated.error };

    await service.from("order_events").insert({
        order_id: order.id,
        kind: "note",
        status: order.fulfillment_status,
        label: "Disputa enviada a CJ",
        description: `Reclamo ${claim.reason} enviado con ${imageUrls.length + videoUrls.length} evidencias.`.slice(0, 500),
    });
    return { ok: true, disputeId: claim.id };
}
