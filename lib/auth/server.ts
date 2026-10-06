import { getServerSupabaseClient, getServiceRoleClient } from "../supabase/server";
import { evaluateAdminAccess } from "./policy";
import type { UserRole } from "../types";

export interface VerifiedUser {
    id: string;
    email: string;
}

export async function getVerifiedUser(): Promise<VerifiedUser | null> {
    const supabase = await getServerSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email || "" };
}

export async function getUserRole(userId: string): Promise<UserRole | null> {
    const service = getServiceRoleClient();
    if (!service) return null;
    const { data, error } = await service
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
    if (error || !data) return null;
    return data.role;
}

export async function getVerifiedAdmin(): Promise<VerifiedUser | null> {
    const user = await getVerifiedUser();
    if (!user) return null;
    const role = await getUserRole(user.id);
    if (role !== "admin") return null;
    return user;
}

export type AdminAuthorization =
    | { ok: true; user: VerifiedUser }
    | { ok: false; status: 401 | 403 };

export async function authorizeAdmin(): Promise<AdminAuthorization> {
    const user = await getVerifiedUser();
    const role = user ? await getUserRole(user.id) : null;
    const verdict = evaluateAdminAccess(user?.id ?? null, role);
    if (!verdict.ok) return verdict;
    return { ok: true, user: user as VerifiedUser };
}
