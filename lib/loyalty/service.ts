import type { SupabaseClientLike } from "../supabase/types.ts";
import type { OrderRow } from "../orders/types.ts";
import { calculateTier } from "../loyalty.ts";
import type { LoyaltyTier } from "../types.ts";

// 1 base point per $1.000 COP of subtotal, scaled by tier multiplier.
// 1 point redeems for $10 COP.
export const POINT_VALUE_COP = 10;
const COP_PER_POINT = 1000;

export interface LoyaltyAccount {
    points: number;
    lifetimePoints: number;
    tier: LoyaltyTier;
}

export function tierMultiplier(tier: LoyaltyTier): number {
    if (tier === "galactico") return 2.0;
    if (tier === "oro") return 1.5;
    if (tier === "plata") return 1.25;
    return 1.0;
}

export function pointsForSubtotal(subtotalCop: number, lifetimePoints: number): number {
    return Math.floor((subtotalCop / COP_PER_POINT) * tierMultiplier(calculateTier(lifetimePoints)));
}

export interface LoyaltyAccountRow {
    user_id: string;
    points: number;
    lifetime_points: number;
}

async function loadAccount(
    service: SupabaseClientLike,
    userId: string
): Promise<LoyaltyAccountRow> {
    const { data } = await service
        .from("loyalty_accounts")
        .select("user_id,points,lifetime_points")
        .eq("user_id", userId)
        .maybeSingle();
    const row = data as LoyaltyAccountRow | null;
    return {
        user_id: userId,
        points: row?.points ?? 0,
        lifetime_points: row?.lifetime_points ?? 0,
    };
}

export async function getLoyaltyBalance(
    userId: string,
    provided?: SupabaseClientLike
): Promise<LoyaltyAccount | { error: string }> {
    const service =
        provided ??
        (await (await import("@/lib/supabase/server")).getServiceRoleClient());
    if (!service) return { error: "service unavailable" };
    const row = await loadAccount(service, userId);
    return { points: row.points, lifetimePoints: row.lifetime_points, tier: calculateTier(row.lifetime_points) };
}

// Resolves the loyalty account owner for an order by customer email →
// profiles row. Guests without a matching account simply don't earn.
async function resolveUserByEmail(
    service: SupabaseClientLike,
    email: string
): Promise<string | null> {
    const { data } = await service
        .from("profiles")
        .select("id,email")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();
    const row = data as { id: string } | null;
    return row?.id ?? null;
}

interface LoyaltyTxRow {
    user_id: string;
    order_id: string | null;
    kind: "earned" | "redeemed" | "restored";
    points: number;
}

async function insertTx(
    service: SupabaseClientLike,
    tx: LoyaltyTxRow
): Promise<"inserted" | "duplicate" | { error: string }> {
    const { error } = await service.from("loyalty_transactions").insert(tx);
    if (!error) return "inserted";
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) return "duplicate";
    return { error: error.message };
}

async function adjustBalance(
    service: SupabaseClientLike,
    userId: string,
    pointsDelta: number,
    lifetimeDelta: number
): Promise<{ ok: true } | { error: string }> {
    const row = await loadAccount(service, userId);
    const next = row.points + pointsDelta;
    const nextLifetime = row.lifetime_points + lifetimeDelta;
    if (next < 0 || nextLifetime < 0) return { error: "insufficient points" };

    if (row.points === 0 && row.lifetime_points === 0 && pointsDelta > 0) {
        const { error } = await service.from("loyalty_accounts").upsert(
            {
                user_id: userId,
                points: next,
                lifetime_points: nextLifetime,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
        );
        if (error) return { error: error.message };
        return { ok: true };
    }

    const { data, error } = await service
        .from("loyalty_accounts")
        .update({
            points: next,
            lifetime_points: nextLifetime,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("points", row.points)
        .eq("lifetime_points", row.lifetime_points)
        .select("user_id");
    if (error) return { error: error.message };
    if (((data as { user_id: string }[] | null) ?? []).length === 0) {
        return { error: "balance changed concurrently" };
    }
    return { ok: true };
}

// Awards points for a paid order. Idempotent via unique(order_id, 'earned').
// Best-effort by design: a loyalty failure must never revert a verified
// payment, so callers log rather than propagate errors.
export async function awardPointsForOrder(
    order: OrderRow,
    provided?: SupabaseClientLike
): Promise<{ ok: true; awarded: number } | { error: string }> {
    const service =
        provided ??
        (await (await import("@/lib/supabase/server")).getServiceRoleClient());
    if (!service) return { error: "service unavailable" };

    const userId = await resolveUserByEmail(service, order.customer_email);
    if (!userId) return { ok: true, awarded: 0 };

    const account = await loadAccount(service, userId);
    const earned = pointsForSubtotal(order.subtotal_cop, account.lifetime_points);
    if (earned <= 0) return { ok: true, awarded: 0 };

    const tx = await insertTx(service, {
        user_id: userId,
        order_id: order.id,
        kind: "earned",
        points: earned,
    });
    if (tx === "duplicate") return { ok: true, awarded: 0 };
    if (tx !== "inserted") return { error: tx.error };

    const adjusted = await adjustBalance(service, userId, earned, earned);
    if ("error" in adjusted) return { error: adjusted.error };
    return { ok: true, awarded: earned };
}

// Debits points for an order at checkout. Inserts the redemption tx first so
// a retried/deduped order cannot double-spend (unique(order_id,'redeemed')),
// then decrements the balance with a read-guarded update.
export async function redeemPointsForOrder(
    userId: string,
    orderId: string,
    points: number,
    provided?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service =
        provided ??
        (await (await import("@/lib/supabase/server")).getServiceRoleClient());
    if (!service) return { error: "service unavailable" };
    if (!Number.isInteger(points) || points <= 0) return { error: "invalid points" };

    const account = await loadAccount(service, userId);
    if (account.points < points) return { error: "insufficient points" };

    const debited = await adjustBalance(service, userId, -points, 0);
    if ("error" in debited) {
        return { error: debited.error === "insufficient points" ? "insufficient points" : "points balance changed; retry" };
    }
    const tx = await insertTx(service, {
        user_id: userId,
        order_id: orderId,
        kind: "redeemed",
        points,
    });
    if (tx === "duplicate") {
        // Redemption already recorded for this order — undo the debit.
        await adjustBalance(service, userId, points, 0);
        return { error: "points already redeemed for this order" };
    }
    if (tx !== "inserted") {
        await adjustBalance(service, userId, points, 0);
        return { error: tx.error };
    }
    return { ok: true };
}

// Returns previously redeemed points when an order reaches a terminal
// non-paid state. Idempotent via unique(order_id, 'restored').
export async function restorePointsForOrder(
    orderId: string,
    provided?: SupabaseClientLike
): Promise<{ ok: true; restored: number } | { error: string }> {
    const service =
        provided ??
        (await (await import("@/lib/supabase/server")).getServiceRoleClient());
    if (!service) return { error: "service unavailable" };

    const { data } = await service
        .from("loyalty_transactions")
        .select("user_id,points")
        .eq("order_id", orderId)
        .eq("kind", "redeemed")
        .maybeSingle();
    const redeemed = data as { user_id: string; points: number } | null;
    if (!redeemed) return { ok: true, restored: 0 };

    const tx = await insertTx(service, {
        user_id: redeemed.user_id,
        order_id: orderId,
        kind: "restored",
        points: redeemed.points,
    });
    if (tx === "duplicate") return { ok: true, restored: 0 };
    if (tx !== "inserted") return { error: tx.error };

    const adjusted = await adjustBalance(service, redeemed.user_id, redeemed.points, 0);
    if ("error" in adjusted) return { error: adjusted.error };
    return { ok: true, restored: redeemed.points };
}
