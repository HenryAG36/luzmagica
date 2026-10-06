export function evaluateAdminAccess(
    userId: string | null,
    role: string | null
): { ok: true } | { ok: false; status: 401 | 403 } {
    if (!userId) return { ok: false, status: 401 };
    if (role !== "admin") return { ok: false, status: 403 };
    return { ok: true };
}
