import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import { refreshTrends } from "../lib/trends/service.ts";
import { importDraft, publishDraft, updateDraft } from "../lib/catalog/repository.ts";
import { evaluateAdminAccess } from "../lib/auth/policy.ts";
import type { FetchLike } from "../lib/trends/http.ts";

function aeEnv() {
    process.env.ALIEXPRESS_APP_KEY = "k";
    process.env.ALIEXPRESS_APP_SECRET = "s";
    process.env.ALIEXPRESS_TRACKING_ID = "t";
}

function clearAeEnv() {
    delete process.env.ALIEXPRESS_APP_KEY;
    delete process.env.ALIEXPRESS_APP_SECRET;
    delete process.env.ALIEXPRESS_TRACKING_ID;
}

test("anonymous users get 401 and customers get 403", () => {
    assert.deepEqual(evaluateAdminAccess(null, null), { ok: false, status: 401 });
    assert.deepEqual(evaluateAdminAccess("u1", null), { ok: false, status: 403 });
    assert.deepEqual(evaluateAdminAccess("u1", "customer"), { ok: false, status: 403 });
    assert.deepEqual(evaluateAdminAccess("u1", "admin"), { ok: true });
});

test("unconfigured sources are skipped without touching the database", async () => {
    clearAeEnv();
    const db = new FakeDb();
    const result = await refreshTrends(db.asClient(), ["aliexpress"]);
    assert.equal(result.skipped.aliexpress, "not configured");
    assert.equal(db.rpcCalls.length, 0);
    assert.equal(db.ops.every((op) => op.kind === "select"), true);
});

test("provider failure retains last good snapshot and records error", async () => {
    aeEnv();
    try {
        const db = new FakeDb();
        const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
        db.tables.trend_snapshots = [
            {
                source: "aliexpress",
                scope: "hot_products",
                payload: { items: [{ id: "keep-me" }] },
                fetched_at: old,
                expires_at: old,
                last_attempt_at: null,
                next_refresh_at: null,
                error: null,
            },
        ];
        const fetchImpl: FetchLike = async () => new Response("{}", { status: 500 });
        await refreshTrends(db.asClient(), ["aliexpress"], { fetchImpl });

        const row = db.tables.trend_snapshots[0];
        assert.deepEqual(row.payload, { items: [{ id: "keep-me" }] });
        assert.equal(row.fetched_at, old);
        assert.equal(typeof row.error, "string");
        assert.ok(row.last_attempt_at);
        assert.ok(row.next_refresh_at);
    } finally {
        clearAeEnv();
    }
});

test("error cooldown defers subsequent refresh attempts", async () => {
    aeEnv();
    try {
        const db = new FakeDb();
        const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
        db.tables.trend_snapshots = [
            {
                source: "aliexpress",
                scope: "hot_products",
                payload: {},
                fetched_at: old,
                expires_at: old,
                last_attempt_at: null,
                next_refresh_at: new Date(Date.now() + 60_000).toISOString(),
                error: "earlier failure",
            },
        ];
        let calls = 0;
        const fetchImpl: FetchLike = async () => {
            calls++;
            return new Response("{}");
        };
        const result = await refreshTrends(db.asClient(), ["aliexpress"], { fetchImpl });
        assert.equal(result.skipped.aliexpress, "refresh cooldown active");
        assert.equal(calls, 0);
    } finally {
        clearAeEnv();
    }
});

test("concurrent refreshes serialize on the provider lease", async () => {
    aeEnv();
    try {
        const db = new FakeDb();
        let calls = 0;
        const fetchImpl: FetchLike = async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 10));
            return new Response(JSON.stringify({}), { status: 200 });
        };
        const [a, b] = await Promise.all([
            refreshTrends(db.asClient(), ["aliexpress"], { fetchImpl }),
            refreshTrends(db.asClient(), ["aliexpress"], { fetchImpl }),
        ]);
        assert.equal(calls, 1);
        assert.ok(a.refreshed.length + b.refreshed.length >= 1);
    } finally {
        clearAeEnv();
    }
});

test("duplicate provider import resolves via unique constraint reread", async () => {
    const db = new FakeDb();
    db.unique.catalog_products = [["source", "provider_item_id"]];
    const input = {
        source: "aliexpress",
        providerItemId: "1005001",
        title: "Lamp",
        createdBy: "admin-1",
    };
    const [first, second] = await Promise.all([
        importDraft(input, db.asClient()),
        importDraft(input, db.asClient()),
    ]);
    assert.equal("created" in first && first.created, true);
    assert.equal("created" in second && second.created, false);
    assert.equal("id" in second && second.id, "imp-aliexpress-1005001");
    assert.equal(db.tables.catalog_products.length, 1);
});

test("draft update and publish require an existing draft row", async () => {
    const db = new FakeDb();
    const upd = await updateDraft("nope", { name: "x" }, db.asClient());
    assert.equal("error" in upd && upd.error, "draft not found");
    assert.equal(await discardCheck(db), "draft not found");
    const res = await publishDraft("nope", "admin-1", {}, db.asClient());
    assert.equal("error" in res && res.error, "draft not found");
});

async function discardCheck(db: FakeDb) {
    const { discardDraft } = await import("../lib/catalog/repository.ts");
    const res = await discardDraft("nope", db.asClient());
    return "error" in res ? res.error : "unexpected";
}

test("publishing is atomic and rejects incomplete drafts", async () => {
    const db = new FakeDb();
    db.unique.catalog_products = [["source", "provider_item_id"]];
    db.tables.catalog_products = [
        {
            id: "imp-aliexpress-1",
            source: "aliexpress",
            provider_item_id: "1",
            name: "Lamp",
            category: "lamparas",
            description: "ok",
            images: ["https://x.test/a.jpg"],
            price_cop: 50000,
            stock: 3,
            supplier_rights_confirmed: true,
            status: "draft",
            updated_at: "2026-01-01T00:00:00.000Z",
        },
    ];
    const client = db.asClient();
    const first = await publishDraft("imp-aliexpress-1", "admin-1", { price_cop: 60000 }, client);
    assert.deepEqual(first, { ok: true });
    assert.equal(db.tables.catalog_products[0].status, "published");
    assert.equal(db.tables.catalog_products[0].price_cop, 60000);

    const second = await publishDraft("imp-aliexpress-1", "admin-1", {}, client);
    assert.equal("error" in second && second.error, "draft not found");
});

test("publish without supplier rights confirmation is rejected", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        {
            id: "d1",
            source: "aliexpress",
            provider_item_id: "9",
            name: "Lamp",
            category: "lamparas",
            description: "ok",
            images: ["https://x.test/a.jpg"],
            price_cop: 50000,
            stock: 3,
            supplier_rights_confirmed: false,
            status: "draft",
            updated_at: "2026-01-01T00:00:00.000Z",
        },
    ];
    const res = await publishDraft("d1", "admin-1", {}, db.asClient());
    assert.ok("missing" in res && res.missing?.includes("supplier_rights_confirmed"));
    assert.equal(db.tables.catalog_products[0].status, "draft");
});
