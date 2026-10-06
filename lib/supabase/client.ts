"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";
import type { SupabaseClientLike } from "./types";

export function getSupabaseBrowserClient(): SupabaseClientLike | null {
    const env = getSupabasePublicEnv();
    if (!env) return null;
    return createBrowserClient(env.url, env.anonKey);
}
