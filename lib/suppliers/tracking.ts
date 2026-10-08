import type { SupabaseClientLike } from "../supabase/types.ts";
import type { FetchLike } from "../trends/http.ts";
import type { OrderRow } from "../orders/types.ts";
import { FULFILLMENT_STATUS_LABELS } from "../orders/types.ts";
import { canTransitionFulfillment } from "../orders/repository.ts";
import { getAliExpressDsEnv } from "../env.ts";
import * as ds from "./aliexpressDs.ts";
import { DS_PROVIDER, getDsAccessToken } from "./dsService.ts";
import {
    fetchCjOrderDetail,
    fetchCjTrackInfo,
    getCjAccessToken,
} from "./cjdropshipping.ts";

const SYNC_THROTTLE_MS = 15 * 60 * 1000;
const SYNC_STALE_MS = 6 * 60 * 60 * 1000;
const SYNC_BATCH = 20;

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

// supplier_order_id is stored as "aliexpress_ds:<id>,cjdropshipping:<id>".
export function parseSupplierRefs(raw: string | null): { ds: string | null; cj: string | null } {
    const refs = { ds: null as string | null, cj: null as string | null };
    if (!raw) return refs;
    for (const part of raw.split(",")) {
        const idx = part.indexOf(":");
        if (idx < 1) continue;
        const provider = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!value) continue;
        if (provider === DS_PROVIDER) refs.ds = value;
        else if (provider === "cjdropshipping") refs.cj = value;
    }
    return refs;
}

interface ProviderSnapshot {
    trackingNumber: string | null;
    carrier: string | null;
    providerStatus: string | null;
    shipped: boolean;
}

const SHIPPED_PATTERN = /ship|dispatch|transit|sent|deliver|complet/i;

async function snapshotDs(orderRef: string, service: SupabaseClientLike, fetchImpl?: FetchLike): Promise<ProviderSnapshot | { error: string }> {
    const env = getAliExpressDsEnv();
    const token = env ? await getDsAccessToken(service, fetchImpl) : { error: "aliexpress ds not configured" };
    if ("error" in token) return { error: `AliExpress DS: ${token.error}` };
    const result = await ds.fetchDsOrderDetail(token.token, orderRef, env!, fetchImpl);
    if (!result.ok || !result.data) return { error: `AliExpress DS: ${result.error ?? "order lookup failed"}` };
    const d = result.data;
    return {
        trackingNumber: d.trackingNo,
        carrier: d.logisticsService,
        providerStatus: d.logisticsStatus ?? d.orderStatus,
        shipped: Boolean(d.trackingNo) || SHIPPED_PATTERN.test(`${d.orderStatus ?? ""} ${d.logisticsStatus ?? ""}`),
    };
}

async function snapshotCj(orderRef: string, service: SupabaseClientLike, fetchImpl?: FetchLike): Promise<ProviderSnapshot | { error: string }> {
    const token = await getCjAccessToken(service, fetchImpl);
    if ("error" in token) return { error: `CJ Dropshipping: ${token.error}` };
    const detail = await fetchCjOrderDetail(token.token, orderRef, fetchImpl);
    if (!detail.ok || !detail.data) return { error: `CJ Dropshipping: ${detail.error ?? "order lookup failed"}` };
    const d = detail.data;
    // Last-mile carrier/number is the leg the Colombian customer can track.
    let carrier = d.logisticName;
    let tracking = d.trackNumber;
    let status = d.orderStatus;
    if (d.trackNumber) {
        const track = await fetchCjTrackInfo(token.token, d.trackNumber, fetchImpl);
        if (track.ok && track.data && track.data.length > 0) {
            const t = track.data[0];
            if (t.lastTrackNumber) tracking = t.lastTrackNumber;
            if (t.lastMileCarrier) carrier = t.lastMileCarrier;
            if (t.trackingStatus) status = t.trackingStatus;
        }
    }
    return {
        trackingNumber: tracking,
        carrier,
        providerStatus: status,
        shipped: Boolean(tracking) || SHIPPED_PATTERN.test(status ?? ""),
    };
}

export interface SyncOutcome {
    ok: true;
    trackingNumber: string | null;
    carrier: string | null;
    providerStatus: string | null;
    fulfillmentAdvanced: boolean;
}

// Pulls the provider's current status for a placed supplier order and
// reconciles it into our tracking fields. Advances fulfillment up to
// international_transit only — "delivered" is never set automatically
// because supplier confirmation does not prove customer receipt. Existing
// non-empty tracking is never overwritten with a blank provider value.
export async function syncOrderTracking(
    orderId: string,
    opts: { force?: boolean } = {},
    provided?: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<SyncOutcome | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data } = await service.from("orders").select("*").eq("id", orderId).maybeSingle();
    const order = (data as OrderRow | null) ?? null;
    if (!order) return { error: "order not found" };
    if (!order.supplier_order_id) return { error: "no supplier order to sync" };
    if (order.fulfillment_status === "delivered" || order.fulfillment_status === "cancelled") {
        return { error: "order is closed" };
    }
    if (
        !opts.force &&
        order.supplier_synced_at &&
        Date.now() - Date.parse(order.supplier_synced_at) < SYNC_THROTTLE_MS
    ) {
        return {
            ok: true,
            trackingNumber: order.tracking_number,
            carrier: order.carrier,
            providerStatus: null,
            fulfillmentAdvanced: false,
        };
    }

    const refs = parseSupplierRefs(order.supplier_order_id);
    const errors: string[] = [];
    let best: ProviderSnapshot | null = null;

    if (refs.ds && refs.ds !== "submitted") {
        const snap = await snapshotDs(refs.ds, service, fetchImpl);
        if ("error" in snap) errors.push(snap.error);
        else best = snap;
    }
    if (refs.cj && refs.cj !== "submitted") {
        const snap = await snapshotCj(refs.cj, service, fetchImpl);
        if ("error" in snap) errors.push(snap.error);
        // Prefer whichever leg produced a tracking number.
        else if (!best?.trackingNumber) best = snap;
        else best = best;
    }

    const now = new Date().toISOString();
    const fields: Record<string, unknown> = { supplier_synced_at: now, updated_at: now };
    const events: { label: string; description: string; status: string }[] = [];

    if (best?.trackingNumber && order.tracking_number !== best.trackingNumber) {
        fields.tracking_number = best.trackingNumber;
        fields.carrier = best.carrier ?? order.carrier;
        events.push({
            label: "Guía registrada",
            status: order.fulfillment_status,
            description: `${best.carrier ?? "Transportadora"}: ${best.trackingNumber} (sincronizado del proveedor)`,
        });
    } else if (best?.carrier && !order.carrier) {
        fields.carrier = best.carrier;
    }

    let fulfillmentAdvanced = false;
    if (
        best?.shipped &&
        canTransitionFulfillment(order.fulfillment_status, "international_transit")
    ) {
        fields.fulfillment_status = "international_transit";
        fulfillmentAdvanced = true;
        events.push({
            label: FULFILLMENT_STATUS_LABELS.international_transit,
            status: "international_transit",
            description: `El proveedor reportó despacho (${best.providerStatus ?? "en tránsito"}).`,
        });
    }

    const { data: updated, error } = await service
        .from("orders")
        .update(fields)
        .eq("id", orderId)
        .eq("updated_at", order.updated_at)
        .select("id");
    if (error) return { error: error.message };
    if (((updated as { id: string }[] | null) ?? []).length === 0) {
        return { error: "order changed during sync; retry" };
    }

    for (const evt of events) {
        await service.from("order_events").insert({
            order_id: orderId,
            kind: "fulfillment",
            status: evt.status,
            label: evt.label,
            description: evt.description.slice(0, 500),
        });
    }

    if (errors.length > 0 && !best) {
        return { error: errors.join(" | ") };
    }
    return {
        ok: true,
        trackingNumber: (fields.tracking_number as string | undefined) ?? order.tracking_number,
        carrier: (fields.carrier as string | undefined) ?? order.carrier,
        providerStatus: best?.providerStatus ?? null,
        fulfillmentAdvanced,
    };
}

// Batch sync for the daily cron and the on-demand panel sweep.
export async function syncDueOrders(
    limit: number = SYNC_BATCH,
    provided?: SupabaseClientLike,
    fetchImpl?: FetchLike
): Promise<{ synced: number; failed: number; skipped: number } | { error: string }> {
    const service = await serviceClient(provided);
    if (!service) return { error: "service unavailable" };

    const { data, error } = await service
        .from("orders")
        .select("id,supplier_order_id,supplier_synced_at,fulfillment_status")
        .in("supplier_order_status", ["submitted", "partial"])
        .limit(limit * 2);
    if (error) return { error: error.message };

    const candidates = ((data as Partial<OrderRow>[] | null) ?? []).filter((o) => {
        if (!o.supplier_order_id) return false;
        if (o.fulfillment_status === "delivered" || o.fulfillment_status === "cancelled") return false;
        if (!o.supplier_synced_at) return true;
        return Date.now() - Date.parse(o.supplier_synced_at) > SYNC_STALE_MS;
    });

    let synced = 0;
    let failed = 0;
    let skipped = 0;
    for (const o of candidates.slice(0, limit)) {
        const result = await syncOrderTracking(o.id as string, {}, service, fetchImpl);
        if ("error" in result) failed += 1;
        else synced += 1;
    }
    skipped = Math.max(0, candidates.length - limit);
    return { synced, failed, skipped };
}
