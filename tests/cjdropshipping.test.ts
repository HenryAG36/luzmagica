import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    fetchCjAccessToken,
    fetchCjTrendingProducts,
    getCjAccessToken,
    normalizeCjProductList,
    normalizeCjTokenResponse,
} from "../lib/suppliers/cjdropshipping.ts";
import { refreshTrends } from "../lib/trends/service.ts";
import { decryptSecret, encryptSecret } from "../lib/crypto.ts";
import type { FetchLike } from "../lib/trends/http.ts";

function cjEnv() {
    process.env.CJ_API_KEY = "cj-key-1";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
}

function clearCjEnv() {
    delete process.env.CJ_API_KEY;
    delete process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
}

function tokenFixture(overrides: Record<string, unknown> = {}) {
    return {
        code: 200,
        result: true,
        data: {
            accessToken: "cj-token-1",
            accessTokenExpiryDate: new Date(Date.now() + 86400_000).toISOString(),
            refreshToken: "cj-refresh-1",
            refreshTokenExpiryDate: new Date(Date.now() + 8640000_00).toISOString(),
            ...overrides,
        },
    };
}

function listFixture(products: Record<string, unknown>[] = [
    {
        id: "b0c7d3a0-9f2d-4f0e-9f1b-1a2b3c4d5e6f",
        nameEn: "Galaxy Lamp",
        sku: "CJ-1",
        bigImage: "https://img.example.com/lamp.jpg",
        sellPrice: "9.90",
        nowPrice: "8.50",
        listedNum: 321,
        threeCategoryName: "Lighting",
    },
]) {
    return { code: 200, result: true, data: { content: [{ productList: products }] } };
}

test("token response requires code 200, result true, token and valid expiry", () => {
    const ok = normalizeCjTokenResponse(tokenFixture());
    assert.ok(ok);
    assert.equal(ok.accessToken, "cj-token-1");
    assert.equal(normalizeCjTokenResponse({ code: 1600200, result: false }), null);
    assert.equal(normalizeCjTokenResponse({ code: 200, result: true, data: {} }), null);
    assert.equal(
        normalizeCjTokenResponse(tokenFixture({ accessTokenExpiryDate: "not-a-date" })),
        null
    );
    assert.equal(normalizeCjTokenResponse(null), null);
});

test("token envelope flags must be present and strict", () => {
    const base = tokenFixture() as Record<string, unknown>;
    assert.equal(normalizeCjTokenResponse({ ...base, code: undefined }), null);
    assert.equal(normalizeCjTokenResponse({ ...base, result: undefined }), null);
    assert.equal(normalizeCjTokenResponse({ ...base, result: "true" }), null);
    assert.ok(normalizeCjTokenResponse({ ...base, code: "200" }));
    assert.equal(
        normalizeCjTokenResponse(
            tokenFixture({ accessTokenExpiryDate: new Date(Date.now() - 1000).toISOString() })
        ),
        null
    );
});

test("token request posts apiKey JSON and list sends CJ-Access-Token", async () => {
    let authBody = "";
    let listHeaders: HeadersInit | undefined;
    let listUrl = "";
    const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes("authentication/getAccessToken")) {
            authBody = String(init?.body ?? "");
            return new Response(JSON.stringify(tokenFixture()), { status: 200 });
        }
        listUrl = url;
        listHeaders = init?.headers;
        return new Response(JSON.stringify(listFixture()), { status: 200 });
    };

    const token = await fetchCjAccessToken("cj-key-1", fetchImpl);
    assert.equal(token.ok, true);
    assert.deepEqual(JSON.parse(authBody), { apiKey: "cj-key-1" });

    const list = await fetchCjTrendingProducts("tok-9", fetchImpl);
    assert.equal(list.ok, true);
    const parsed = new URL(listUrl);
    assert.equal(parsed.pathname, "/api2.0/v1/product/listV2");
    assert.equal(parsed.searchParams.get("page"), "1");
    assert.equal(parsed.searchParams.get("size"), "20");
    assert.equal(parsed.searchParams.get("productFlag"), "0");
    assert.equal(parsed.searchParams.get("orderBy"), "1");
    assert.equal((listHeaders as Record<string, string>)["CJ-Access-Token"], "tok-9");
});

test("product list flattens content productList with listingCount not sales", () => {
    const items = normalizeCjProductList(listFixture());
    assert.ok(items);
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.source, "cjdropshipping");
    assert.equal(item.signalType, "supplier_trending");
    assert.equal(item.listingCount, 321);
    assert.equal(item.salesVolume, null);
    assert.equal(item.rank, null);
    assert.equal(item.url, null);
    assert.equal(item.price, 8.5);
    assert.equal(item.category, "Lighting");
});

test("product list drops invalid entries and caps at 20", () => {
    const many = Array(30)
        .fill(null)
        .map((_, i) => ({ id: `id-${i}`, nameEn: `P${i}`, listedNum: i }));
    const items = normalizeCjProductList(listFixture([{ bad: true }, ...many]));
    assert.ok(items);
    assert.equal(items.length, 20);
    assert.equal(items[0].sourceId, "id-0");
    assert.equal(normalizeCjProductList({ code: 500 }), null);
    assert.equal(normalizeCjProductList({ code: 200, data: {} }), null);
    assert.equal(normalizeCjProductList({ code: 200, result: true, data: {} }), null);
    assert.equal(normalizeCjProductList({ code: 200, data: { content: [] } }), null);
    assert.equal(normalizeCjProductList(listFixture([{ nameEn: "no id" }]))!.length, 0);
});

test("list error codes are surfaced sanitized, never raw messages", async () => {
    const fetchImpl: FetchLike = async () =>
        new Response(
            JSON.stringify({ code: 1600200, message: "invalid apiKey=SECRET_LEAK" }),
            { status: 200 }
        );
    const res = await fetchCjTrendingProducts("tok", fetchImpl);
    assert.equal(res.ok, false);
    assert.equal(res.error, "provider error 1600200");
    assert.ok(!res.error?.includes("SECRET_LEAK"));

    const missingFlags: FetchLike = async () =>
        new Response(JSON.stringify({ data: { content: [] } }), { status: 200 });
    const res2 = await fetchCjTrendingProducts("tok", missingFlags);
    assert.equal(res2.ok, false);
    assert.equal(res2.error, "provider error unknown");

    const resultFalse: FetchLike = async () =>
        new Response(JSON.stringify({ code: 200, result: false }), { status: 200 });
    const res3 = await fetchCjTrendingProducts("tok", resultFalse);
    assert.equal(res3.ok, false);
    assert.equal(res3.error, "provider result false");
});

test("valid stored token is reused without an auth call", async () => {
    cjEnv();
    try {
        const db = new FakeDb();
        const secret = "a".repeat(64);
        db.tables.provider_connections = [
            {
                provider: "cjdropshipping",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-token", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        let calls = 0;
        const result = await getCjAccessToken(db.asClient(), async () => {
            calls++;
            throw new Error("should not fetch");
        });
        assert.deepEqual(result, { token: "cached-token" });
        assert.equal(calls, 0);
    } finally {
        clearCjEnv();
    }
});

test("expired token re-authenticates with apiKey and persists encrypted", async () => {
    cjEnv();
    try {
        const db = new FakeDb();
        const secret = "a".repeat(64);
        db.tables.provider_connections = [
            {
                provider: "cjdropshipping",
                status: "connected",
                access_token_encrypted: encryptSecret("old-token", secret),
                token_expires_at: new Date(Date.now() - 1000).toISOString(),
            },
        ];
        const result = await getCjAccessToken(db.asClient(), async () =>
            new Response(JSON.stringify(tokenFixture()), { status: 200 })
        );
        assert.deepEqual(result, { token: "cj-token-1" });
        const row = db.tables.provider_connections[0];
        assert.equal(row.status, "connected");
        assert.equal(decryptSecret(String(row.access_token_encrypted), secret), "cj-token-1");
    } finally {
        clearCjEnv();
    }
});

test("token persistence failure fails closed", async () => {
    cjEnv();
    try {
        const db = new FakeDb();
        db.failUpdates = new Set(["provider_connections"]);
        db.failUpserts = new Set(["provider_connections"]);
        const result = await getCjAccessToken(db.asClient(), async () =>
            new Response(JSON.stringify(tokenFixture()), { status: 200 })
        );
        assert.deepEqual(result, { error: "credential persistence failed" });
        assert.equal(
            db.tables.provider_connections.every((r) => r.access_token_encrypted == null),
            true
        );
    } finally {
        clearCjEnv();
    }
});

test("unconfigured cj source skips refresh without touching the database", async () => {
    clearCjEnv();
    const db = new FakeDb();
    const result = await refreshTrends(db.asClient(), ["cjdropshipping"]);
    assert.equal(result.skipped.cjdropshipping, "not configured");
    assert.equal(db.rpcCalls.length, 0);
});

test("cj failure preserves the last good snapshot", async () => {
    cjEnv();
    try {
        const db = new FakeDb();
        const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
        db.tables.trend_snapshots = [
            {
                source: "cjdropshipping",
                scope: "trending_products",
                payload: { items: [{ id: "keep-me" }] },
                fetched_at: old,
                expires_at: old,
                last_attempt_at: null,
                next_refresh_at: null,
                error: null,
            },
        ];
        const fetchImpl: FetchLike = async () => new Response("boom", { status: 500 });
        const result = await refreshTrends(db.asClient(), ["cjdropshipping"], { fetchImpl });
        assert.ok(result.errors.cjdropshipping);
        const snapshot = db.tables.trend_snapshots[0];
        assert.deepEqual((snapshot.payload as { items: { id: string }[] }).items, [{ id: "keep-me" }]);
        assert.ok(snapshot.error);
        assert.ok(snapshot.next_refresh_at);
    } finally {
        clearCjEnv();
    }
});

test("cj refresh writes a snapshot on success", async () => {
    cjEnv();
    try {
        const db = new FakeDb();
        const secret = "a".repeat(64);
        db.tables.provider_connections = [
            {
                provider: "cjdropshipping",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-token", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        const fetchImpl: FetchLike = async (url) => {
            if (url.includes("listV2")) {
                return new Response(JSON.stringify(listFixture()), { status: 200 });
            }
            throw new Error("unexpected auth call");
        };
        const result = await refreshTrends(db.asClient(), ["cjdropshipping"], { fetchImpl });
        assert.deepEqual(result.refreshed, ["cjdropshipping"]);
        const snapshot = db.tables.trend_snapshots.find(
            (r) => r.source === "cjdropshipping" && r.scope === "trending_products"
        );
        assert.ok(snapshot);
        const items = (snapshot!.payload as { items: { signalType: string }[] }).items;
        assert.equal(items[0].signalType, "supplier_trending");
    } finally {
        clearCjEnv();
    }
});
