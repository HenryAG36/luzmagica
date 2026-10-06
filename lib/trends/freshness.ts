export const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
export const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
export const LEASE_TTL_SECONDS = 120;
export const REFRESH_DEADLINE_MS = 105 * 1000;

export function isFresh(fetchedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
    if (!fetchedAt) return false;
    const ts = Date.parse(fetchedAt);
    if (Number.isNaN(ts)) return false;
    return nowMs - ts < SNAPSHOT_TTL_MS;
}

export function refreshDue(
    row: { next_refresh_at: string | null } | null | undefined,
    nowMs: number = Date.now()
): boolean {
    if (!row || !row.next_refresh_at) return true;
    const ts = Date.parse(row.next_refresh_at);
    if (Number.isNaN(ts)) return true;
    return nowMs >= ts;
}
