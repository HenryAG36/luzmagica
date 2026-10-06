import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeRedirectPath } from "../lib/auth/redirect.ts";
import { decryptSecret, encryptSecret } from "../lib/crypto.ts";
import { getAliExpressEnv, getMeliEnv, getSupabasePublicEnv } from "../lib/env.ts";
import { isFresh, SNAPSHOT_TTL_MS } from "../lib/trends/freshness.ts";

test("safeRedirectPath allows only local paths", () => {
    assert.equal(safeRedirectPath("/operator"), "/operator");
    assert.equal(safeRedirectPath("/products/1"), "/products/1");
    assert.equal(safeRedirectPath("//evil.com"), "/");
    assert.equal(safeRedirectPath("https://evil.com"), "/");
    assert.equal(safeRedirectPath("javascript:alert(1)"), "/");
    assert.equal(safeRedirectPath(null), "/");
    assert.equal(safeRedirectPath(""), "/");
});

test("token encryption roundtrips and rejects wrong keys", () => {
    const secret = "a".repeat(64);
    const enc = encryptSecret("access-token-123", secret);
    assert.notEqual(enc, "access-token-123");
    assert.equal(decryptSecret(enc, secret), "access-token-123");
    assert.equal(decryptSecret(enc, "b".repeat(64)), null);
    assert.equal(decryptSecret("garbage", secret), null);
});

test("supabase env fails closed when unset", () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
        assert.equal(getSupabasePublicEnv(), null);
    } finally {
        if (url) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
        if (key) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
    }
});

test("provider envs fail closed without credentials", () => {
    const saved = {
        MELI_CLIENT_ID: process.env.MELI_CLIENT_ID,
        MELI_CLIENT_SECRET: process.env.MELI_CLIENT_SECRET,
        MELI_REDIRECT_URI: process.env.MELI_REDIRECT_URI,
        ALIEXPRESS_APP_KEY: process.env.ALIEXPRESS_APP_KEY,
        ALIEXPRESS_APP_SECRET: process.env.ALIEXPRESS_APP_SECRET,
        ALIEXPRESS_TRACKING_ID: process.env.ALIEXPRESS_TRACKING_ID,
    };
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
        assert.equal(getMeliEnv(), null);
        assert.equal(getAliExpressEnv(), null);
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v) process.env[k] = v;
        }
    }
});

test("snapshot freshness uses bounded six hour TTL", () => {
    const now = Date.now();
    assert.equal(isFresh(new Date(now - 1000).toISOString(), now), true);
    assert.equal(isFresh(new Date(now - SNAPSHOT_TTL_MS - 1).toISOString(), now), false);
    assert.equal(isFresh(null, now), false);
    assert.equal(isFresh("not-a-date", now), false);
});

test("migration keeps roles separate and registration cannot self-elevate", () => {
    const sql = readFileSync(join(import.meta.dirname, "../supabase/migrations/20261006023124_foundation.sql"), "utf8");
    assert.match(sql, /create table if not exists public\.user_roles/);
    assert.match(sql, /values \(\s*new\.id,\s*'customer'\s*\)/);
    assert.doesNotMatch(sql, /raw_user_meta_data\s*->>?\s*'role'/);
    assert.match(sql, /prevent_last_admin_removal/);
    assert.match(sql, /enable row level security/);
});

test("public projection never exposes supplier fields", () => {
    const sql = readFileSync(join(import.meta.dirname, "../supabase/migrations/20261006023145_trends_and_catalog.sql"), "utf8");
    const viewMatch = sql.match(/create or replace view public\.published_products as([\s\S]*?)from public\.catalog_products/);
    assert.ok(viewMatch);
    assert.doesNotMatch(viewMatch![1], /supplier|fx_|listing_/);
    assert.match(sql, /revoke all on public\.catalog_products from anon, authenticated/);
});

test("lease RPCs are service-role only with exact grant statements", () => {
    const sql = readFileSync(join(import.meta.dirname, "../supabase/migrations/20261006023145_trends_and_catalog.sql"), "utf8");
    assert.ok(
        sql.includes(
            "revoke all on function public.try_acquire_refresh_lease(text,text,text,integer) from public, anon, authenticated;"
        )
    );
    assert.ok(
        sql.includes(
            "grant execute on function public.try_acquire_refresh_lease(text,text,text,integer) to service_role;"
        )
    );
    assert.ok(
        sql.includes(
            "revoke all on function public.release_refresh_lease(text,text,text) from public, anon, authenticated;"
        )
    );
    assert.ok(
        sql.includes(
            "grant execute on function public.release_refresh_lease(text,text,text) to service_role;"
        )
    );
});

test("last-admin protection uses advisory lock and safe TG_OP branching", () => {
    const sql = readFileSync(join(import.meta.dirname, "../supabase/migrations/20261006023124_foundation.sql"), "utf8");
    assert.match(sql, /pg_advisory_xact_lock\(765225\)/);
    assert.match(sql, /before delete or update of role/);
    assert.match(sql, /cannot remove the last administrator/);
    const guard = sql.indexOf("if old.role = 'admin' and (TG_OP = 'DELETE' or new.role <> 'admin')");
    const deleteReturn = sql.indexOf("if TG_OP = 'DELETE' then");
    assert.ok(guard > -1 && deleteReturn > guard);
});
