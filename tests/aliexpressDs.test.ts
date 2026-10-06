import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    buildAuthorizationUrl,
    buildDsProviderItemId,
    buildSignedRequestUrl,
    fetchDsFreightQuote,
    fetchDsProduct,
    getDsFreightResponseError,
    isValidDsProductId,
    normalizeDsFreightResponse,
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

function freightFixture(optionOverrides: Record<string, unknown>[] = []) {
    const base = {
        code: "AE_STANDARD",
        company: "AliExpress Standard Shipping",
        shipping_fee_currency: "USD",
        shipping_fee_cent: "1.99",
        shipping_fee_format: "US $1.99",
        free_shipping: "false",
        min_delivery_days: "20",
        max_delivery_days: "40",
        available_stock: "100",
        ddpIncludeVATTax: "true",
    };
    return {
        code: "0",
        result: {
            code: "200",
            success: "true",
            delivery_options: optionOverrides.length
                ? optionOverrides.map((o) => ({ ...base, ...o }))
                : [base],
        },
    };
}

test("normalizeDsFreightResponse maps documented fields and USD fee", () => {
    const options = normalizeDsFreightResponse(freightFixture());
    assert.ok(options);
    assert.equal(options.length, 1);
    const o = options[0];
    assert.equal(o.company, "AliExpress Standard Shipping");
    assert.equal(o.feeUsd, 1.99);
    assert.equal(o.minDays, 20);
    assert.equal(o.maxDays, 40);
    assert.equal(o.availableStock, 100);
    assert.equal(o.ddpIncludesVatTax, true);
    assert.equal(o.freeShipping, false);
});

test("normalizeDsFreightResponse accepts the wrapped response envelope", () => {
    const wrapped = { aliexpress_ds_freight_query_response: freightFixture() };
    const options = normalizeDsFreightResponse(wrapped);
    assert.ok(options && options.length === 1);
});

test("freight fee requires USD format agreement, otherwise unavailable", () => {
    const mismatch = normalizeDsFreightResponse(
        freightFixture([{ shipping_fee_format: "US $5.00" }])
    );
    assert.ok(mismatch);
    assert.equal(mismatch[0].feeUsd, null);

    const noFormat = normalizeDsFreightResponse(
        freightFixture([{ shipping_fee_format: "" }])
    );
    assert.ok(noFormat);
    assert.equal(noFormat[0].feeUsd, null);

    const nonUsd = normalizeDsFreightResponse(
        freightFixture([{ shipping_fee_currency: "EUR" }])
    );
    assert.ok(nonUsd);
    assert.equal(nonUsd[0].feeUsd, null);
});

test("free_shipping permits absent fee but rejects inconsistent positive fee", () => {
    const free = normalizeDsFreightResponse(
        freightFixture([
            { free_shipping: "true", shipping_fee_cent: "", shipping_fee_format: "", shipping_fee_currency: "" },
        ])
    );
    assert.ok(free);
    assert.equal(free[0].freeShipping, true);
    assert.equal(free[0].feeUsd, 0);

    const inconsistent = normalizeDsFreightResponse(
        freightFixture([{ free_shipping: "true", shipping_fee_cent: "3.50", shipping_fee_format: "US $3.50" }])
    );
    assert.ok(inconsistent);
    assert.equal(inconsistent.length, 0);
});

test("freight response errors are surfaced, not treated as empty quotes", () => {
    assert.equal(normalizeDsFreightResponse(null), null);
    assert.equal(normalizeDsFreightResponse({ code: "0" }), null);
    assert.equal(
        normalizeDsFreightResponse({ code: "0", result: { code: "500", success: "false" } }),
        null
    );
    assert.match(getDsFreightResponseError({ error_response: { code: "Forbidden" } }) ?? "", /Forbidden/);
    assert.match(
        getDsFreightResponseError({ aliexpress_ds_freight_query_response: { code: "0", result: { code: "500", success: "false" } } }) ?? "",
        /freight code 500/
    );
    assert.equal(
        getDsFreightResponseError({ aliexpress_ds_freight_query_response: { code: "34" } }),
        "provider error 34"
    );
});

test("fetchDsFreightQuote sends queryDeliveryReq over /sync with session", async () => {
    let captured = "";
    const fetchImpl: FetchLike = async (url) => {
        captured = url;
        return new Response(JSON.stringify(freightFixture()), { status: 200 });
    };
    const res = await fetchDsFreightQuote("tok-9", "1005001234567890", "sku-77", CONFIG, fetchImpl);
    assert.equal(res.ok, true);
    assert.ok(res.data);
    assert.equal(res.data.destination, "Bogota");
    assert.equal(res.data.quantity, 1);
    const parsed = new URL(captured);
    assert.equal(parsed.pathname, "/sync");
    assert.equal(parsed.searchParams.get("method"), "aliexpress.ds.freight.query");
    assert.equal(parsed.searchParams.get("session"), "tok-9");
    const req = JSON.parse(parsed.searchParams.get("queryDeliveryReq") ?? "{}");
    assert.equal(req.quantity, "1");
    assert.equal(req.shipToCountry, "CO");
    assert.equal(req.productId, "1005001234567890");
    assert.equal(req.selectedSkuId, "sku-77");
    assert.equal(req.city, "Bogota");
    assert.equal(req.currency, "USD");
    assert.equal(req.language, "es");
});

test("fetchDsFreightQuote surfaces provider errors", async () => {
    const fetchImpl: FetchLike = async () =>
        new Response(
            JSON.stringify({ aliexpress_ds_freight_query_response: { code: "0", result: { code: "500", success: "false" } } }),
            { status: 200 }
        );
    const res = await fetchDsFreightQuote("tok", "1005001234567890", "s1", CONFIG, fetchImpl);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /freight code 500/);
});

test("free_shipping with a nonzero formatted price is rejected too", () => {
    const options = normalizeDsFreightResponse(
        freightFixture([
            { free_shipping: "true", shipping_fee_cent: "", shipping_fee_format: "US $2.50" },
        ])
    );
    assert.ok(options);
    assert.equal(options.length, 0);
});

function feedFixture(ids: unknown[] = ["1005001234567890", "1005002234567890"]) {
    return {
        aliexpress_ds_feed_itemids_get_response: {
            code: "0",
            ret: "true",
            rsp_code: "200",
            rsp_msg: "success",
            result: { total: "42", products: ids, search_id: "s-1" },
        },
    };
}

test("feed item ids validated: envelope, canonical ids, max 10", async () => {
    const { fetchDsFeedItemIds, normalizeDsFeedItemIds } = await import("../lib/suppliers/aliexpressDs.ts");
    const page = normalizeDsFeedItemIds(feedFixture(["1", "abc", "x".repeat(21), "2", "1"]));
    assert.ok(page);
    assert.deepEqual(page.productIds, ["1", "2"]);
    assert.equal(page.total, 42);
    assert.equal(page.searchId, "s-1");
    assert.equal(normalizeDsFeedItemIds(feedFixture(Array(15).fill(1).map((_, i) => String(i))))!.productIds.length, 10);
    assert.equal(normalizeDsFeedItemIds({ code: "0" }), null);

    let captured = "";
    const fetchImpl: FetchLike = async (url) => {
        captured = url;
        return new Response(JSON.stringify(feedFixture()), { status: 200 });
    };
    const res = await fetchDsFeedItemIds("tok", CONFIG, fetchImpl);
    assert.equal(res.ok, true);
    const parsed = new URL(captured);
    assert.equal(parsed.pathname, "/sync");
    assert.equal(parsed.searchParams.get("method"), "aliexpress.ds.feed.itemids.get");
    assert.equal(parsed.searchParams.get("page_size"), "10");
    assert.equal(parsed.searchParams.get("feed_name"), "DS bestseller");
    assert.equal(parsed.searchParams.get("session"), "tok");
});

test("feed item ids surface provider rejections without faking", async () => {
    const { fetchDsFeedItemIds } = await import("../lib/suppliers/aliexpressDs.ts");
    for (const [body, match] of [
        [{ aliexpress_ds_feed_itemids_get_response: { code: "27" } }, /error 27/],
        [{ aliexpress_ds_feed_itemids_get_response: { code: "0", ret: "false" } }, /ret false/],
        [{ aliexpress_ds_feed_itemids_get_response: { code: "0", ret: "true", rsp_code: "500" } }, /rsp_code 500/],
        [{ error_response: { code: "IllegalAccess" } }, /IllegalAccess/],
    ] as const) {
        const fetchImpl: FetchLike = async () => new Response(JSON.stringify(body), { status: 200 });
        const res = await fetchDsFeedItemIds("tok", CONFIG, fetchImpl);
        assert.equal(res.ok, false);
        assert.match(res.error ?? "", match);
    }
});

test("feed items preserve order, mark partial failures, fail closed when all fail", async () => {
    const { fetchDsFeedItems } = await import("../lib/suppliers/aliexpressDs.ts");
    const calls: string[] = [];
    const okFetch: FetchLike = async (url) => {
        const method = new URL(url).searchParams.get("method") ?? "";
        if (method.includes("feed.itemids")) {
            return new Response(JSON.stringify(feedFixture(["1005001234567890", "1005002234567890"])), { status: 200 });
        }
        calls.push(new URL(url).searchParams.get("product_id") ?? "");
        return new Response(JSON.stringify(productFixture()), { status: 200 });
    };
    const res = await fetchDsFeedItems("tok", CONFIG, okFetch);
    assert.equal(res.ok, true);
    assert.deepEqual(res.data?.items.map((i) => i.sourceId), ["1005001234567890", "1005002234567890"]);
    assert.equal(res.data?.items[0].signalType, "supplier_feed");
    assert.equal(res.data?.items[0].rank, null);
    assert.equal(res.data?.items[0].salesVolume, null);
    assert.equal(res.data?.items[0].price, null);
    assert.equal(res.data?.items[0].url, "https://www.aliexpress.com/item/1005001234567890.html");

    const partialFetch: FetchLike = async (url) => {
        const parsed = new URL(url);
        const method = parsed.searchParams.get("method") ?? "";
        if (method.includes("feed.itemids")) {
            return new Response(JSON.stringify(feedFixture(["1111111111", "2222222222"])), { status: 200 });
        }
        if (parsed.searchParams.get("product_id") === "1111111111") {
            return new Response(JSON.stringify({ error_response: { code: "Boom" } }), { status: 200 });
        }
        return new Response(JSON.stringify(productFixture()), { status: 200 });
    };
    const partial = await fetchDsFeedItems("tok", CONFIG, partialFetch);
    assert.equal(partial.ok, true);
    assert.deepEqual(partial.data?.items.map((i) => i.sourceId), ["2222222222"]);
    assert.match(partial.data?.partialError ?? "", /1 of 2/);

    const allFail: FetchLike = async (url) => {
        const method = new URL(url).searchParams.get("method") ?? "";
        if (method.includes("feed.itemids")) {
            return new Response(JSON.stringify(feedFixture(["1111111111"])), { status: 200 });
        }
        return new Response(JSON.stringify({ error_response: { code: "Boom" } }), { status: 200 });
    };
    const empty = await fetchDsFeedItems("tok", CONFIG, allFail);
    assert.equal(empty.ok, false);
    assert.match(empty.error ?? "", /all feed item details failed/);
});

test("ds feed refresh writes a snapshot via the shared provider lease", async () => {
    dsEnv();
    try {
        const { refreshTrends } = await import("../lib/trends/service.ts");
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-ds-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        const fetchImpl: FetchLike = async (url) => {
            const method = new URL(url).searchParams.get("method") ?? "";
            if (method.includes("feed.itemids")) {
                return new Response(JSON.stringify(feedFixture(["1005001234567890"])), { status: 200 });
            }
            return new Response(JSON.stringify(productFixture()), { status: 200 });
        };
        const result = await refreshTrends(db.asClient(), ["aliexpress_ds"], { fetchImpl });
        assert.deepEqual(result.refreshed, ["aliexpress_ds"]);
        const snapshot = db.tables.trend_snapshots.find(
            (r) => r.source === "aliexpress_ds" && r.scope === "bestseller_feed"
        );
        assert.ok(snapshot);
        const items = (snapshot!.payload as { items: { signalType: string; sourceId: string }[] }).items;
        assert.equal(items.length, 1);
        assert.equal(items[0].signalType, "supplier_feed");
        assert.equal(items[0].sourceId, "1005001234567890");
        assert.ok(
            db.rpcCalls.some((c) => c.fn === "try_acquire_refresh_lease" && c.args.p_source === "aliexpress_ds")
        );
    } finally {
        clearDsEnv();
    }
});

test("explicit empty feed is a successful empty result, not an all-fail", async () => {
    const { fetchDsFeedItems } = await import("../lib/suppliers/aliexpressDs.ts");
    const fetchImpl: FetchLike = async (url) => {
        const method = new URL(url).searchParams.get("method") ?? "";
        if (method.includes("feed.itemids")) {
            return new Response(JSON.stringify(feedFixture([])), { status: 200 });
        }
        throw new Error("no detail calls expected for an empty feed");
    };
    const res = await fetchDsFeedItems("tok", CONFIG, fetchImpl);
    assert.equal(res.ok, true);
    assert.deepEqual(res.data?.items, []);
});

test("unattempted feed items count as failures when the deadline hits", async () => {
    const { fetchDsFeedItems } = await import("../lib/suppliers/aliexpressDs.ts");
    const origNow = Date.now;
    let fakeNow = 1_000_000;
    Date.now = () => fakeNow;
    try {
        const fetchImpl: FetchLike = async (url) => {
            const method = new URL(url).searchParams.get("method") ?? "";
            if (method.includes("feed.itemids")) {
                return new Response(JSON.stringify(feedFixture(["1", "2", "3"])), { status: 200 });
            }
            const res = new Response(JSON.stringify(productFixture()), { status: 200 });
            fakeNow += 20_000;
            return res;
        };
        const res = await fetchDsFeedItems("tok", CONFIG, fetchImpl, fakeNow + 10_000);
        assert.equal(res.ok, true);
        assert.equal(res.data?.items.length, 1);
        assert.match(res.data?.partialError ?? "", /2 of 3/);
    } finally {
        Date.now = origNow;
    }
});

test("ds feed partial failure writes items plus an error on the snapshot", async () => {
    dsEnv();
    try {
        const { refreshTrends } = await import("../lib/trends/service.ts");
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-ds-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        const fetchImpl: FetchLike = async (url) => {
            const parsed = new URL(url);
            const method = parsed.searchParams.get("method") ?? "";
            if (method.includes("feed.itemids")) {
                return new Response(JSON.stringify(feedFixture(["1111111111", "2222222222"])), { status: 200 });
            }
            if (parsed.searchParams.get("product_id") === "1111111111") {
                return new Response(JSON.stringify({ error_response: { code: "Boom" } }), { status: 200 });
            }
            return new Response(JSON.stringify(productFixture()), { status: 200 });
        };
        const result = await refreshTrends(db.asClient(), ["aliexpress_ds"], { fetchImpl });
        assert.match(result.errors.aliexpress_ds ?? "", /1 of 2/);
        const snapshot = db.tables.trend_snapshots.find(
            (r) => r.source === "aliexpress_ds" && r.scope === "bestseller_feed"
        );
        assert.ok(snapshot);
        const items = (snapshot!.payload as { items: { sourceId: string }[] }).items;
        assert.deepEqual(items.map((i) => i.sourceId), ["2222222222"]);
        assert.match(String(snapshot!.error ?? ""), /1 of 2/);
    } finally {
        clearDsEnv();
    }
});

test("exception inside ds refresh is caught, recorded, and the lease released", async () => {
    dsEnv();
    try {
        const { refreshTrends } = await import("../lib/trends/service.ts");
        const secret = "a".repeat(64);
        const db = new FakeDb();
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-ds-token", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        const client = db.asClient();
        const origFrom = client.from.bind(client);
        let providerReads = 0;
        client.from = ((table: string) => {
            if (table === "provider_connections" && ++providerReads === 3) {
                throw new Error("connection read blew up");
            }
            return origFrom(table);
        }) as typeof client.from;
        const result = await refreshTrends(client, ["aliexpress_ds"], {
            fetchImpl: async () => {
                throw new Error("no fetch expected");
            },
        });
        assert.equal(result.errors.aliexpress_ds, "refresh failed");
        const snapshot = db.tables.trend_snapshots.find(
            (r) => r.source === "aliexpress_ds" && r.scope === "bestseller_feed"
        );
        assert.equal(snapshot?.error, "refresh failed");
        assert.ok(
            db.rpcCalls.some(
                (c) => c.fn === "release_refresh_lease" && c.args.p_source === "aliexpress_ds"
            )
        );
    } finally {
        clearDsEnv();
    }
});

test("feed envelope requires documented success flags and explicit products array", async () => {
    const { normalizeDsFeedItemIds, fetchDsFeedItemIds } = await import("../lib/suppliers/aliexpressDs.ts");
    const inner = feedFixture().aliexpress_ds_feed_itemids_get_response;

    assert.equal(
        normalizeDsFeedItemIds({
            aliexpress_ds_feed_itemids_get_response: { ...inner, ret: undefined },
        }),
        null
    );
    assert.equal(
        normalizeDsFeedItemIds({
            aliexpress_ds_feed_itemids_get_response: { ...inner, result: { total: "1" } },
        }),
        null
    );
    assert.equal(
        normalizeDsFeedItemIds({
            aliexpress_ds_feed_itemids_get_response: { ...inner, result: "oops" },
        }),
        null
    );
    assert.equal(
        normalizeDsFeedItemIds({
            aliexpress_ds_feed_itemids_get_response: { ...inner, result: { products: ["abc", null, -1] } },
        }),
        null
    );
    assert.deepEqual(
        normalizeDsFeedItemIds({
            aliexpress_ds_feed_itemids_get_response: {
                ...inner,
                result: { products: ["1", Number.MAX_SAFE_INTEGER * 2, 1.5] },
            },
        })?.productIds,
        ["1"]
    );

    const missingFlags: FetchLike = async () =>
        new Response(
            JSON.stringify({ aliexpress_ds_feed_itemids_get_response: { result: { products: [] } } }),
            { status: 200 }
        );
    const res = await fetchDsFeedItemIds("tok", CONFIG, missingFlags);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /provider error missing|ret missing|rsp_code missing/);

    const noProducts: FetchLike = async () =>
        new Response(
            JSON.stringify({
                aliexpress_ds_feed_itemids_get_response: {
                    code: "0",
                    ret: "true",
                    rsp_code: "200",
                    result: { total: "7" },
                },
            }),
            { status: 200 }
        );
    const res2 = await fetchDsFeedItemIds("tok", CONFIG, noProducts);
    assert.equal(res2.ok, false);
    assert.match(res2.error ?? "", /feed response malformed: missing result\.products/);
});
