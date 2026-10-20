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

// --- Catalog lookup (product/query, stock/queryByVid, freightCalculate) -----

import {
    normalizeCjCatalogProduct,
    normalizeCjStock,
    normalizeCjFreightOptions,
} from "../lib/suppliers/cjCatalog.ts";

function cjDetailFixture(overrides: Record<string, unknown> = {}) {
    return {
        code: 200,
        result: true,
        data: {
            pid: "PID-1",
            productNameEn: "Galaxy Projector",
            bigImage: "https://img.example.com/main.jpg",
            productImageSet: ["https://img.example.com/a.jpg", "javascript:alert(1)", "notaurl"],
            productSku: "CJ-SKU-1",
            categoryName: "Electronics / Lighting > Projectors",
            description: "<p>Star <b>projector</b></p><script>alert(1)</script>",
            productWeight: "0.5",
            productUnit: "piece",
            materialNameEnSet: ["ABS", "PC"],
            productProEnSet: ["No battery"],
            variants: [
                {
                    vid: "VID-1",
                    pid: "PID-1",
                    variantNameEn: "White",
                    variantSku: "CJ-W",
                    variantKey: "color:white",
                    variantImage: "https://img.example.com/w.jpg",
                    variantSellPrice: "12.50",
                    variantWeight: "0.4",
                    variantLength: "10",
                    variantWidth: "8",
                    variantHeight: "5",
                    inventories: [
                        { countryCode: "CN", totalInventory: 12912, cjInventory: 0, factoryInventory: 12912 },
                        { countryCode: "US", totalInventory: 50, cjInventory: 50, factoryInventory: 0 },
                    ],
                },
                {
                    vid: "VID-2",
                    variantNameEn: "Black",
                    variantSellPrice: "13.00",
                    inventories: [{ countryCode: "CN", totalInventory: 3 }],
                },
            ],
            ...overrides,
        },
    };
}

test("cj catalog detail maps variants, strips HTML and filters unsafe images", () => {
    const product = normalizeCjCatalogProduct(cjDetailFixture(), "PID-1");
    assert.ok(product);
    assert.equal(product.source, "cjdropshipping");
    assert.equal(product.productId, "PID-1");
    assert.equal(product.title, "Galaxy Projector");
    assert.equal(product.category, "Projectors");
    assert.equal(product.description.includes("<script"), false);
    assert.equal(product.description, "Star projector");
    assert.deepEqual(product.images, [
        "https://img.example.com/main.jpg",
        "https://img.example.com/a.jpg",
    ]);
    assert.equal(product.sourceUrl, null);
    assert.equal(product.variants.length, 2);
    const v1 = product.variants[0];
    assert.equal(v1.id, "VID-1");
    assert.equal(v1.label, "White");
    assert.equal(v1.price, 12.5);
    assert.equal(v1.currency, "USD");
    assert.equal(v1.stock, 12912); // CN total only, never CN+US or total+subtotals
    assert.equal(v1.attributes.weight_g, 0.4);
    assert.equal(product.details.product_sku, "CJ-SKU-1");
});

test("cj catalog detail rejects pid mismatch and provider errors", () => {
    assert.equal(normalizeCjCatalogProduct(cjDetailFixture(), "OTHER"), null);
    assert.equal(normalizeCjCatalogProduct({ code: 1600200, result: false, data: {} }, "PID-1"), null);
    assert.equal(normalizeCjCatalogProduct(null, "PID-1"), null);
    assert.equal(
        normalizeCjCatalogProduct(cjDetailFixture({ productNameEn: "   " }), "PID-1"),
        null
    );
    // missing sell price → price null, not fabricated
    const noPrice = normalizeCjCatalogProduct(
        cjDetailFixture({ variants: [{ vid: "V9", variantSellPrice: "abc" }] }),
        "PID-1"
    );
    assert.equal(noPrice?.variants[0].price, null);
});

test("cj stock reads flat country rows; nested warehouse stock never summed", () => {
    const raw = {
        code: 200,
        result: true,
        data: [
            {
                vid: "VID-1",
                countryCode: "CN",
                totalInventoryNum: 10877,
                cjInventoryNum: 700,
                factoryInventoryNum: 10177,
                // nested per-warehouse leaves — must be ignored entirely
                stock: [{ stockId: "x", inventory: 0, factoryInventory: 11092 }],
            },
            { vid: "VID-1", countryCode: "US", totalInventoryNum: 99, stock: [] },
        ],
    };
    assert.equal(normalizeCjStock(raw, "VID-1"), 10877); // not 11092, not 10877+99, not 10877+700+10177

    // any row naming a different vid → reject whole response
    assert.equal(normalizeCjStock({ ...raw, data: [...raw.data, { vid: "OTHER", countryCode: "CN", totalInventoryNum: 1 }] }, "VID-1"), null);
    // no CN row → null
    assert.equal(normalizeCjStock({ code: 200, result: true, data: [{ vid: "V", countryCode: "US", totalInventoryNum: 9 }] }, "V"), null);
    // CN zero is real stock data, not "unknown"
    assert.equal(normalizeCjStock({ code: 200, result: true, data: [{ vid: "V", countryCode: "CN", totalInventoryNum: 0 }] }, "V"), 0);
    // CN row without a usable total → null
    assert.equal(normalizeCjStock({ code: 200, result: true, data: [{ vid: "V", countryCode: "CN" }] }, "V"), null);
    // malformed total → null, never a guess
    assert.equal(normalizeCjStock({ code: 200, result: true, data: [{ vid: "V", countryCode: "CN", totalInventoryNum: "x" }] }, "V"), null);
    assert.equal(normalizeCjStock({ code: 200, result: true, data: "x" }, "VID-1"), null);
    assert.equal(normalizeCjStock({ code: 500, result: false }, "VID-1"), null);
});

test("cj freight uses totalPostageFee or USD fee parts, dedupes, rejects invalid", () => {
    const raw = {
        code: 200,
        result: true,
        data: [
            { logisticName: "CJ Packet", logisticPrice: 2.5, logisticAging: "10-15", totalPostageFee: 3.2 },
            { logisticName: "CJ Packet", logisticPrice: 999 },
            { logisticName: "Postal", logisticPrice: 2.5, taxesFee: 1, clearanceOperationFee: 0.5 },
            { logisticName: "BadFee", logisticPrice: 4, taxesFee: "abc" },
            { logisticName: "BadTotal", logisticPrice: 4, totalPostageFee: "bad" },
            { logisticName: "ZeroTotal", logisticPrice: 4, totalPostageFee: 0 },
            { logisticName: "NoPrice" },
            { logisticPrice: 5 },
        ],
    };
    const options = normalizeCjFreightOptions(raw);
    assert.ok(options);
    assert.deepEqual(options.map((o) => o.id), ["CJ Packet", "Postal", "BadFee", "BadTotal", "ZeroTotal", "NoPrice"]);
    assert.equal(options[0].feeUsd, 3.2);
    assert.equal(options[0].delivery, "10-15");
    assert.equal(options[1].feeUsd, 4);
    assert.equal(options[2].feeUsd, null); // supplied-but-invalid fee voids the price
    assert.equal(options[3].feeUsd, null); // invalid totalPostageFee must NOT fall back to parts
    assert.equal(options[4].feeUsd, 0);    // supplied zero total is a real 0
    assert.equal(options[5].feeUsd, null);
    assert.equal(normalizeCjFreightOptions({ code: 500 }), null);
    assert.equal(normalizeCjFreightOptions({ code: 200, result: true, data: {} }), null);
});
