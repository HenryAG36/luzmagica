import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, getServiceRoleKey } from "@/lib/env";
import type { SupabaseClientLike } from "./types";

export async function getServerSupabaseClient(): Promise<SupabaseClientLike | null> {
    const env = getSupabasePublicEnv();
    if (!env) return null;

    const cookieStore = await cookies();
    return createServerClient(env.url, env.anonKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options)
                    );
                } catch {
                }
            },
        },
    });
}

export function getServiceRoleClient(): SupabaseClientLike | null {
    const env = getSupabasePublicEnv();
    const serviceKey = getServiceRoleKey();
    if (!env || !serviceKey) return null;
    return createClient(env.url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

export function getAnonServerClient(): SupabaseClientLike | null {
    const env = getSupabasePublicEnv();
    if (!env) return null;
    return createClient(env.url, env.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}
