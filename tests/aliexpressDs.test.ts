import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    buildAuthorizationUrl,
    buildDsProviderItemId,
    buildSignedRequestUrl,
    fetchDsProduct,
    isValidDsProductId,
    normalizeDsProduct,
    signApiRequest,
    stripHtmlToText,
    validateDsCallback,
} from "../lib/suppliers/aliexpressDs.ts";
import { getDsAccessToken, lookupDsProduct } from "../lib/suppliers/dsService.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { sanitizeSupplierVariant } from "../lib/catalog/validate.ts";
import type { FetchLike } from "../lib/trends/http.ts";

const CONFIG = { appKey: "key1", appSecret: "secret1", redirectUri: "https://app.test/cb" };

test("signApiRequest matches the documented algorithm vector", () => {
    const sign = signApiRequest(
        "/test/api",
        { bar: "2", foo: "1", foo_bar: "3", foobar: "4" },
        "helloworld"
    );
    assert.equal(sign, "BD011266EC150C787B2201495AA2D6F326BB6910DE77E84EA28F5215DCD7FA5E");
});

test("buildAuthorizationUrl uses the documented authorize endpoint", () => {
    const url = buildAuthorizationUrl(CONFIG, "st8");
    assert.ok(url.startsWith("https://api-sg.aliexpress.com/oauth/authorize?"));
    const params = new URL(url).searchParams;
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("client_id"), "key1");
    assert.equal(params.get("redirect_uri"), "https://app.test/cb");
    assert.equal(params.get("state"), "st8");
});

test("signed request URLs include system params, session, and a valid sign", () => {
    const url = buildSignedRequestUrl(
        "/auth/token/create",
        CONFIG,
        { code: "3_1_abc" },
        undefined,
        1700000000000
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://api-sg.aliexpress.com/rest/auth/token/create");
    const p = parsed.searchParams;
    assert.equal(p.get("app_key"), "key1");
    assert.equal(p.get("sign_method"), "sha256");
    assert.equal(p.get("timestamp"), "1700000000000");
    assert.equal(p.get("code"), "3_1_abc");
    assert.equal(p.get("method"), null);
    const params: Record<string, string> = {};
    for (const [k, v] of p.entries()) if (k !== "sign") params[k] = v;
    assert.equal(p.get("sign"), signApiRequest("/auth/token/create", params, CONFIG.appSecret));
});

test("dotted business methods use /sync with method param signed without prefix", () => {
    const url = buildSignedRequestUrl(
        "aliexpress.ds.product.get",
        CONFIG,
        { product_id: "123" },
        "tok",
        1700000000000
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://api-sg.aliexpress.com/sync");
    const p = parsed.searchParams;
    assert.equal(p.get("method"), "aliexpress.ds.product.get");
    assert.equal(p.get("session"), "tok");
    const params: Record<string, string> = {};
    for (const [k, v] of p.entries()) if (k !== "sign") params[k] = v;
    assert.equal(p.get("sign"), signApiRequest("", params, CONFIG.appSecret));
});

test("DS callback state is bound to the admin and expires with the cookie", () => {
    const cookie = "abc123.user-1";
    assert.equal(validateDsCallback(cookie, "abc123", "user-1").ok, true);
    assert.deepEqual(validateDsCallback(cookie, "other", "user-1"), { ok: false, reason: "state_mismatch" });
    assert.deepEqual(validateDsCallback(cookie, "abc123", "user-2"), { ok: false, reason: "wrong_user" });
    assert.deepEqual(validateDsCallback(undefined, "abc123", "user-1"), { ok: false, reason: "missing_cookie" });
    assert.deepEqual(validateDsCallback(cookie, null, "user-1"), { ok: false, reason: "missing_state" });
    assert.deepEqual(validateDsCallback("no-separator", "abc123", "user-1"), { ok: false, reason: "malformed_cookie" });
});

test("product ids are validated and reject unsafe input", () => {
    assert.equal(isValidDsProductId("1005001234567890"), true);
    assert.equal(isValidDsProductId("12"), false);
    assert.equal(isValidDsProductId("abc/../x"), false);
    assert.equal(isValidDsProductId("http://evil.com"), false);
    assert.equal(isValidDsProductId(null), false);
});

function productFixture(overrides: Record<string, unknown> = {}) {
    return {
        aliexpress_ds_product_get_response: {
            rsp_code: "200",
            rsp_msg: "Call succeeds",
            result: {
                ae_item_base_info_dto: {
                    subject: "Smart Lamp",
                    product_id: "1005001234567890",
                    currency_code: "USD",
                    sales_count: "3210",
                    category_id: "12345",
                    detail: "<div><p>Bright <b>lamp</b></p><script>alert(1)</script></div>",
                    ...(overrides.base as Record<string, unknown> | undefined),
                },
                ae_item_sku_info_dtos: overrides.skus ?? [
                    { sku_id: "s1", sku_attr: "color:white", offer_sale_price: "12.30", sku_price: "15.00", sku_available_stock: "42", currency_code: "USD" },
                    { sku_id: "s2", sku_attr: "color:black", offer_sale_price: "12.90", sku_price: "16.00", sku_available_stock: "7", currency_code: "USD" },
                ],
                ae_multimedia_info_dto: {
                    image_urls: "https://ae01.example.com/a.jpg;https://ae01.example.com/b.jpg",
                },
                logistics_info_dto: { delivery_time: "15" },
            },
        },
    };
}

test("normalizeDsProduct maps base info, SKUs, images and sanitizes HTML", () => {
    const product = normalizeDsProduct(productFixture(), "1005001234567890");
    assert.ok(product);
    assert.equal(product.title, "Smart Lamp");
    assert.equal(product.providerReportedSales, 3210);
    assert.equal(product.deliveryTimeDays, 15);
    assert.deepEqual(product.images, ["https://ae01.example.com/a.jpg", "https://ae01.example.com/b.jpg"]);
    assert.equal(product.skus.length, 2);
    assert.equal(product.skus[0].offerSalePrice, 12.3);
    assert.equal(product.skus[0].availableStock, 42);
    assert.equal(product.descriptionText.includes("<script"), false);
    assert.equal(product.descriptionText, "Bright lamp");
    assert.equal(product.sourceUrl, "https://www.aliexpress.com/item/1005001234567890.html");
});

test("normalizeDsProduct rejects malformed and non-200 responses", () => {
    assert.equal(normalizeDsProduct(null, "1"), null);
    assert.equal(normalizeDsProduct({ aliexpress_ds_product_get_response: { result: { ae_item_base_info_dto: {} } } }, "1"), null);
});

test("fetchDsProduct surfaces provider rsp_code errors", async () => {
    const fetchImpl: FetchLike = async () =>
        new Response(
            JSON.stringify({ aliexpress_ds_product_get_response: { rsp_code: "400", rsp_msg: "bad product" } }),
            { status: 200 }
        );
    const res = await fetchDsProduct("tok", "1005001234567890", CONFIG, fetchImpl);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /rsp_code 400/);
});

test("fetchDsProduct surfaces error_response failures", async () => {
    const fetchImpl: FetchLike = async () =>
        new Response(JSON.stringify({ error_response: { code: "InsufficientSessionPermission" } }), { status: 200 });
    const res = await fetchDsProduct("tok", "1005001234567890", CONFIG, fetchImpl);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /InsufficientSessionPermission/);
});

test("fetchDsProduct sends documented lookup params and session token", async () => {
    let captured = "";
    const fetchImpl: FetchLike = async (url) => {
        captured = url;
        return new Response(JSON.stringify(productFixture()), { status: 200 });
    };
    const res = await fetchDsProduct("tok-1", "1005001234567890", CONFIG, fetchImpl);
    assert.equal(res.ok, true);
    const parsed = new URL(captured);
    assert.equal(parsed.pathname, "/sync");
    const p = parsed.searchParams;
    assert.equal(p.get("method"), "aliexpress.ds.product.get");
    assert.equal(p.get("product_id"), "1005001234567890");
    assert.equal(p.get("ship_to_country"), "CO");
    assert.equal(p.get("target_currency"), "USD");
    assert.equal(p.get("target_language"), "es");
    assert.equal(p.get("remove_personal_benefit"), "true");
    assert.equal(p.get("session"), "tok-1");
});

function dsEnv() {
    process.env.ALIEXPRESS_DS_APP_KEY = "key1";
    process.env.ALIEXPRESS_DS_APP_SECRET = "secret1";
    process.env.ALIEXPRESS_DS_REDIRECT_URI = "https://app.test/cb";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
}

function clearDsEnv() {
    delete process.env.ALIEXPRESS_DS_APP_KEY;
    delete process.env.ALIEXPRESS_DS_APP_SECRET;
    delete process.env.ALIEXPRESS_DS_REDIRECT_URI;
    delete process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
}

test("concurrent lookups serialize token refresh under the provider lease", async () => {
    dsEnv();
    try {
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("old-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() - 1000).toISOString(),
            },
        ];
        let refreshCalls = 0;
        let productCalls = 0;
        const fetchImpl: FetchLike = async (url) => {
            if (url.includes("/auth/token/refresh")) {
                refreshCalls++;
                await new Promise((r) => setTimeout(r, 10));
                return new Response(
                    JSON.stringify({ code: "0", access_token: "new-token", refresh_token: "rt-2", expires_in: 86400 }),
                    { status: 200 }
                );
            }
            productCalls++;
            return new Response(JSON.stringify(productFixture()), { status: 200 });
        };
        const client = db.asClient();
        const [a, b] = await Promise.all([
            lookupDsProduct(client, "1005001234567890", fetchImpl),
            lookupDsProduct(client, "1005001234567890", fetchImpl),
        ]);
        assert.equal(refreshCalls, 1);
        assert.equal(productCalls, 1);
        assert.ok("product" in a || "product" in b);
        assert.ok("error" in a || "error" in b);
    } finally {
        clearDsEnv();
    }
});

test("token refresh failure returns a sanitized error", async () => {
    dsEnv();
    try {
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("old-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() - 1000).toISOString(),
            },
        ];
        const fetchImpl: FetchLike = async () =>
            new Response(JSON.stringify({ code: "27", msg: "invalid refresh token rt-1" }), { status: 200 });
        const result = await getDsAccessToken(db.asClient(), fetchImpl);
        assert.deepEqual(result, { error: "token refresh failed" });
        assert.equal(db.tables.provider_connections[0].status, "error");
    } finally {
        clearDsEnv();
    }
});

test("lookup rejects invalid ids without touching the provider", async () => {
    const db = new FakeDb();
    const result = await lookupDsProduct(db.asClient(), "not-a-product");
    assert.deepEqual(result, { error: "invalid product id" });
    assert.equal(db.rpcCalls.length, 0);
});

test("provider item ids pair product and sku; variant data is bounded", () => {
    assert.equal(buildDsProviderItemId("1005001234567890", "s1"), "1005001234567890-s1");
    const variant = sanitizeSupplierVariant({ sku_id: "s1", sku_attr: "color:white" });
    assert.deepEqual(variant, { sku_id: "s1", sku_attr: "color:white" });
    assert.equal(sanitizeSupplierVariant("not-an-object"), null);
    assert.equal(sanitizeSupplierVariant({ big: "x".repeat(9000) }), null);
});

test("stripHtmlToText removes tags, scripts, and decodes entities", () => {
    assert.equal(stripHtmlToText("<p>Hello &amp; <b>bye</b></p>"), "Hello & bye");
    assert.equal(stripHtmlToText("<script>evil()</script><p>ok</p>"), "ok");
    assert.equal(stripHtmlToText(null), "");
    assert.equal(stripHtmlToText("&#999999999999;x"), "x");
});

test("token responses with missing or invalid expiry are rejected", async () => {
    const { normalizeDsTokenResponse } = await import("../lib/suppliers/aliexpressDs.ts");
    assert.equal(
        normalizeDsTokenResponse({ code: "0", access_token: "t", refresh_token: "r" }),
        null
    );
    assert.equal(
        normalizeDsTokenResponse({ code: "0", access_token: "t", expire_time: "not-a-number" }),
        null
    );
    assert.equal(
        normalizeDsTokenResponse({ code: "0", access_token: "t", expires_in: 86400 })?.accessToken,
        "t"
    );
    assert.equal(normalizeDsTokenResponse({ code: "27", access_token: "t" }), null);
    assert.equal(normalizeDsTokenResponse({ code: "0", access_token: "", expires_in: 5 }), null);
    assert.equal(normalizeDsTokenResponse({ code: "0", access_token: "t", expires_in: 1e300 }), null);
    assert.equal(
        normalizeDsTokenResponse({ code: "0", access_token: "t", expire_time: Number.MAX_SAFE_INTEGER * 2 }),
        null
    );
});

test("token persistence failure fails closed instead of returning rotated token", async () => {
    dsEnv();
    try {
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.failUpdates = new Set(["provider_connections"]);
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("old-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() - 1000).toISOString(),
            },
        ];
        const fetchImpl: FetchLike = async () =>
            new Response(
                JSON.stringify({ code: "0", access_token: "new-token", refresh_token: "rt-2", expires_in: 86400 }),
                { status: 200 }
            );
        const result = await getDsAccessToken(db.asClient(), fetchImpl);
        assert.deepEqual(result, { error: "credential persistence failed" });
        assert.equal(db.tables.provider_connections[0].status, "error");
    } finally {
        clearDsEnv();
    }
});
