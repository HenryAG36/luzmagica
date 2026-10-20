import { test } from "node:test";
import assert from "node:assert/strict";
import type { FetchLike } from "../lib/trends/http.ts";
import {
    isValidMastershopProductId,
    mastershopProductBelongsToAccount,
    mastershopRequest,
    normalizeMastershopProduct,
    previewMastershopProduct,
    searchMastershopProducts,
} from "../lib/suppliers/mastershop.ts";

// Contract verified against the official Postman collection: base
// https://prod.api.mastershop.com, `ms-api-key` auth header,
// POST /api/products/market (page = row offset, limit 20, plain array),
// GET /api/products/market/{id} (authoritative detail) and
// GET /api/products/{id}?includeAllVariations=true (account membership).

function summaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        idProduct: 88597,
        productName: "Audífonos inalámbricos",
        description: "<p>Bluetooth 5.3</p>",
        urlImageProduct: "https://cdn.mastershop.com/img.jpg",
        basePrice: 89900,
        suggestedPrice: 95500,
        category: "Tecnología",
        idCategory: 12,
        nameProvider: "Proveedor Uno",
        baseCurrencyPrice: "COP",
        variantsCount: 3,
        stock: 1494,
        ...overrides,
    };
}

function detailProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        idProduct: 88597,
        nameProduct: "Audífonos inalámbricos",
        description: "<p>Bluetooth 5.3</p>",
        baseCurrencyPrice: "COP",
        providerPrice: 89900,
        stock: 1494,
        suggestedPrice: 95500,
        categoryName: "Tecnología",
        urlImageProduct: "https://cdn.mastershop.com/img.jpg",
        providerName: "Proveedor Uno",
        variants: [
            { sku: "", name: "Default Variant", price: 89900, stock: 500, idVariant: 195337 },
            { sku: "", name: "Negro", price: 52500, stock: 497, idVariant: 195338 },
        ],
        ...overrides,
    };
}

function simpleDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        idProduct: 100813,
        nameProduct: "Mochila urbana",
        description: "Mochila 20L",
        baseCurrencyPrice: "COP",
        providerPrice: 118000,
        stock: 50,
        suggestedPrice: 140000,
        categoryName: "Accesorios",
        urlImageProduct: "https://cdn.mastershop.com/m.jpg",
        variants: [],
        ...overrides,
    };
}

function env() {
    process.env.MASTERSHOP_API_KEY = "mastershop-key-1";
}
function clearEnv() {
    delete process.env.MASTERSHOP_API_KEY;
}

// --- product id validation ---------------------------------------------------

test("mastershop product ids are bounded positive safe-integer strings", () => {
    assert.ok(isValidMastershopProductId("1"));
    assert.ok(isValidMastershopProductId("88597"));
    assert.equal(isValidMastershopProductId("0"), false);
    assert.equal(isValidMastershopProductId("01"), false);
    assert.equal(isValidMastershopProductId("MS-9"), false);
    assert.equal(isValidMastershopProductId("9999999999999999"), false); // 16 digits > safe int
    assert.equal(isValidMastershopProductId(88597), false);
});

// --- request shape -----------------------------------------------------------

test("request uses fixed host, ms-api-key header and redirect:error", async () => {
    env();
    try {
        const captured: { url: string; init: RequestInit }[] = [];
        const fetchImpl: FetchLike = async (url, init) => {
            captured.push({ url: String(url), init: init as RequestInit });
            return new Response("{}", { status: 200 });
        };
        const res = await mastershopRequest("/api/products/market/88597", { method: "GET" }, fetchImpl);
        assert.ok(res.ok);
        assert.equal(captured.length, 1);
        assert.equal(captured[0].url, "https://prod.api.mastershop.com/api/products/market/88597");
        const headers = captured[0].init.headers as Record<string, string>;
        assert.equal(headers["ms-api-key"], "mastershop-key-1");
        assert.equal(captured[0].init.redirect, "error");
        assert.equal(captured[0].init.cache, "no-store");
    } finally {
        clearEnv();
    }
});

test("missing MASTERSHOP_API_KEY fails before any fetch", async () => {
    clearEnv();
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return new Response("{}", { status: 200 });
    };
    const res = await mastershopRequest("/api/products/market/1", { method: "GET" }, fetchImpl);
    assert.equal(res.ok, false);
    assert.equal(calls, 0);
});

test("non-/api/ paths are rejected before any fetch", async () => {
    env();
    try {
        let calls = 0;
        const fetchImpl: FetchLike = async () => {
            calls++;
            return new Response("{}", { status: 200 });
        };
        for (const p of ["api/products", "https://evil.example/api/x", "//api/x", "/api/../x"]) {
            const res = await mastershopRequest(p, { method: "GET" }, fetchImpl);
            assert.equal(res.ok, false, p);
        }
        assert.equal(calls, 0);
    } finally {
        clearEnv();
    }
});

test("provider errors are generic Spanish and never echo the key or body", async () => {
    env();
    try {
        const cases: [number, string][] = [
            [401, "rechazó el acceso"],
            [403, "rechazó el acceso"],
            [404, "no encontró"],
            [429, "limitando"],
            [500, "HTTP 500"],
        ];
        for (const [status, fragment] of cases) {
            const fetchImpl: FetchLike = async () =>
                new Response(`secret-body mastershop-key-1`, { status });
            const res = await mastershopRequest("/api/products/market/1", { method: "GET" }, fetchImpl);
            assert.equal(res.ok, false);
            if (!res.ok) {
                assert.ok(res.error.includes(fragment), `${status}: ${res.error}`);
                assert.ok(!res.error.includes("mastershop-key-1"), "key must not leak");
                assert.ok(!res.error.includes("secret-body"), "raw body must not leak");
            }
        }
    } finally {
        clearEnv();
    }
});

// --- normalization -----------------------------------------------------------

test("simple product (empty variants) uses parent price/stock as 'simple' variant", () => {
    const p = normalizeMastershopProduct(simpleDetail());
    assert.ok(p);
    if (!p) return;
    assert.equal(p.source, "mastershop");
    assert.equal(p.productId, "100813");
    assert.equal(p.title, "Mochila urbana");
    assert.equal(p.variants.length, 1);
    const v = p.variants[0];
    assert.equal(v.id, "simple");
    assert.equal(v.label, "Único");
    assert.equal(v.price, 118000);
    assert.equal(v.stock, 50);
    assert.equal(v.currency, "COP");
    assert.equal(p.details.suggested_price, 140000);
    assert.equal(p.sourceUrl, "https://app.mastershop.com/products/market/100813");
    assert.equal(p.images[0], "https://cdn.mastershop.com/m.jpg");
});

test("variant products keep each variant's own price/stock only", () => {
    const p = normalizeMastershopProduct(detailProduct());
    assert.ok(p);
    if (!p) return;
    assert.equal(p.variants.length, 2);
    assert.equal(p.variants[0].id, "195337");
    assert.equal(p.variants[0].label, "Default Variant");
    assert.equal(p.variants[0].price, 89900);
    assert.equal(p.variants[0].stock, 500);
    assert.equal(p.variants[1].price, 52500); // never the parent 89900 twice
    assert.deepEqual(p.variants[1].attributes.suggested_price, 95500);
    assert.equal(p.details.provider_name, "Proveedor Uno");
});

test("non-primitive and non-grammar numerics are unknown, never coerced", () => {
    for (const bad of [[], [12], {}, true, " ", "12x", "0x10", Infinity]) {
        assert.equal(
            normalizeMastershopProduct(simpleDetail({ providerPrice: bad }))?.variants[0].price,
            null,
            `price ${JSON.stringify(bad)}`
        );
        assert.equal(
            normalizeMastershopProduct(simpleDetail({ stock: bad }))?.variants[0].stock,
            null,
            `stock ${JSON.stringify(bad)}`
        );
        assert.equal(
            normalizeMastershopProduct(
                detailProduct({ variants: [{ idVariant: 1, name: "A", price: bad, stock: 1 }] })
            )?.variants[0].price,
            null,
            `variant price ${JSON.stringify(bad)}`
        );
    }
    // a present-but-invalid variant price must NOT fall back to providerPrice
    const p = normalizeMastershopProduct(
        detailProduct({ variants: [{ idVariant: 1, name: "A", price: null, stock: 2 }] })
    );
    assert.equal(p?.variants[0].price, null);
    // valid zero is preserved
    assert.equal(
        normalizeMastershopProduct(simpleDetail({ stock: 0 }))?.variants[0].stock,
        0
    );
    // integer numeric strings pass; fractional amounts are not safe integers
    assert.equal(
        normalizeMastershopProduct(simpleDetail({ providerPrice: "118000" }))?.variants[0].price,
        118000
    );
    assert.equal(
        normalizeMastershopProduct(simpleDetail({ providerPrice: "5000.50" }))?.variants[0].price,
        null
    );
});

test("only literal COP currency is accepted", () => {
    assert.equal(normalizeMastershopProduct(simpleDetail({ baseCurrencyPrice: "USD" }))?.variants[0].currency, null);
    assert.equal(normalizeMastershopProduct(simpleDetail({ baseCurrencyPrice: "cop" }))?.variants[0].currency, null);
    assert.equal(normalizeMastershopProduct(simpleDetail({ baseCurrencyPrice: undefined }))?.variants[0].currency, null);
    assert.equal(normalizeMastershopProduct(simpleDetail())?.variants[0].currency, "COP");
    // non-COP amounts must never be displayed as pesos — price and the
    // suggested retail are nulled alongside the currency
    const usd = normalizeMastershopProduct(simpleDetail({ baseCurrencyPrice: "USD" }));
    assert.equal(usd?.variants[0].price, null);
    assert.equal(usd?.details.suggested_price, null);
    const usdVar = normalizeMastershopProduct(detailProduct({ baseCurrencyPrice: "USD" }));
    assert.equal(usdVar?.variants[0].price, null);
    assert.equal(usdVar?.variants[0].attributes.suggested_price, null);
});

test("malformed, missing or duplicate variant ids invalidate the product", () => {
    assert.equal(normalizeMastershopProduct(detailProduct({ variants: [{ idVariant: 1 }, "oops"] })), null);
    assert.equal(normalizeMastershopProduct(detailProduct({ variants: [{ idVariant: 1 }, { nope: true }] })), null);
    assert.equal(
        normalizeMastershopProduct(
            detailProduct({ variants: [{ idVariant: 5, name: "A" }, { idVariant: 5, name: "B" }] })
        ),
        null
    );
    assert.equal(normalizeMastershopProduct(detailProduct({ variants: "not-array" })), null);
});

test("required identity and name fields are enforced", () => {
    assert.equal(normalizeMastershopProduct({ nameProduct: "x" }), null);
    assert.equal(normalizeMastershopProduct(simpleDetail({ nameProduct: "" })), null);
    assert.equal(normalizeMastershopProduct(simpleDetail({ idProduct: 0 })), null);
    assert.equal(normalizeMastershopProduct("nope"), null);
    // unsafe image scheme is dropped, not passed through
    assert.equal(
        normalizeMastershopProduct(simpleDetail({ urlImageProduct: "javascript:alert(1)" }))?.images.length,
        0
    );
});

// --- search ------------------------------------------------------------------

test("search uses POST /api/products/market with row-offset page and limit 20", async () => {
    env();
    try {
        const seen: { url: string; body: string }[] = [];
        const fetchImpl: FetchLike = async (url, init) => {
            seen.push({ url: String(url), body: String((init as RequestInit).body) });
            return new Response(JSON.stringify([summaryRow()]), { status: 200 });
        };
        const first = await searchMastershopProducts("audífonos", 0, fetchImpl);
        assert.ok("page" in first);
        assert.equal(seen[0].url, "https://prod.api.mastershop.com/api/products/market?page=0&limit=20");
        assert.deepEqual(JSON.parse(seen[0].body), { valueToSearch: "audífonos" });
        const second = await searchMastershopProducts("", 20, fetchImpl);
        assert.ok("page" in second);
        assert.equal(seen[1].url, "https://prod.api.mastershop.com/api/products/market?page=20&limit=20");
        assert.deepEqual(JSON.parse(seen[1].body), {}); // empty search — no mutation fields
    } finally {
        clearEnv();
    }
});

test("search normalizes summary rows as discovery-only and keeps offset semantics", async () => {
    env();
    try {
        const rows = [summaryRow(), summaryRow({ idProduct: 999, productName: "Otro" }), { garbage: true }];
        const fetchImpl: FetchLike = async () => new Response(JSON.stringify(rows), { status: 200 });
        const res = await searchMastershopProducts("ok", 40, fetchImpl);
        assert.ok("page" in res);
        if ("page" in res) {
            assert.equal(res.page.offset, 40);
            assert.equal(res.page.hasMore, false); // raw page had 3 rows, not 20
            assert.equal(res.page.products.length, 2);
            assert.equal(res.page.products[0].source, "mastershop");
            assert.equal(res.page.products[0].productId, "88597");
            assert.equal(res.page.products[0].details.discovery_only, 1);
            assert.equal(res.page.products[0].variants[0].id, "simple");
            assert.ok(res.page.warnings.some((w) => w.includes("omitidos")));
        }
    } finally {
        clearEnv();
    }
});

test("search hasMore follows raw page size (20)", async () => {
    env();
    try {
        const rows = Array.from({ length: 20 }, (_, i) => summaryRow({ idProduct: 1000 + i }));
        const fetchImpl: FetchLike = async () => new Response(JSON.stringify(rows), { status: 200 });
        const res = await searchMastershopProducts("", 0, fetchImpl);
        assert.ok("page" in res && res.page.hasMore);
    } finally {
        clearEnv();
    }
});

test("search rejects oversized/invalid query and out-of-range offset without fetching", async () => {
    env();
    try {
        let calls = 0;
        const fetchImpl: FetchLike = async () => {
            calls++;
            return new Response("[]", { status: 200 });
        };
        for (const q of ["x".repeat(121), "bad<script>", 7 as unknown as string]) {
            const res = await searchMastershopProducts(q, 0, fetchImpl);
            assert.ok("error" in res, String(q).slice(0, 20));
        }
        for (const off of [-1, 100001, 1.5]) {
            const res = await searchMastershopProducts("ok", off, fetchImpl);
            assert.ok("error" in res, String(off));
        }
        const ok = await searchMastershopProducts("ok", 100000, fetchImpl);
        assert.ok("page" in ok);
        assert.equal(calls, 1);
    } finally {
        clearEnv();
    }
});

// --- detail + preview --------------------------------------------------------

test("empty or non-object detail responses are not-found errors", async () => {
    env();
    try {
        for (const body of ["[]", "null", "\"x\""]) {
            const fetchImpl: FetchLike = async () => new Response(body, { status: 200 });
            const res = await previewMastershopProduct("88597", undefined, fetchImpl);
            assert.ok("error" in res, body);
        }
    } finally {
        clearEnv();
    }
});

test("detail identity must match the requested id", async () => {
    env();
    try {
        const fetchImpl: FetchLike = async () =>
            new Response(JSON.stringify(detailProduct({ idProduct: 99999 })), { status: 200 });
        const res = await previewMastershopProduct("88597", undefined, fetchImpl);
        assert.ok("error" in res);
        if ("error" in res) assert.ok(res.error.includes("no coincide") || res.error.includes("coincide"));
    } finally {
        clearEnv();
    }
});

test("preview refetches authoritative detail — summary data is never used", async () => {
    env();
    try {
        const urls: string[] = [];
        const fetchImpl: FetchLike = async (url) => {
            urls.push(String(url));
            return new Response(JSON.stringify(simpleDetail()), { status: 200 });
        };
        const res = await previewMastershopProduct("100813", undefined, fetchImpl);
        assert.ok("preview" in res);
        assert.equal(urls.length, 1);
        assert.equal(urls[0], "https://prod.api.mastershop.com/api/products/market/100813");
        if ("preview" in res) {
            assert.equal(res.preview.selectedVariantId, "simple"); // sole variant autoselects
            assert.equal(res.preview.freight.length, 0);
            assert.equal(res.preview.fx, null);
            assert.equal(res.preview.freightCheckedAt, null);
            assert.ok(res.preview.warnings.some((w) => w.includes("Mis productos")));
            assert.ok(res.preview.warnings.some((w) => w.includes("cotización")));
        }
    } finally {
        clearEnv();
    }
});

test("multi-variant preview does not autoselect; explicit variant id must exist", async () => {
    env();
    try {
        const fetchImpl: FetchLike = async () =>
            new Response(JSON.stringify(detailProduct()), { status: 200 });
        const res = await previewMastershopProduct("88597", undefined, fetchImpl);
        assert.ok("preview" in res);
        if ("preview" in res) {
            assert.equal(res.preview.selectedVariantId, null);
            assert.ok(res.preview.warnings.some((w) => w.includes("variantes")));
        }
        const picked = await previewMastershopProduct("88597", "195338", fetchImpl);
        assert.ok("preview" in picked);
        if ("preview" in picked) {
            assert.equal(picked.preview.selectedVariantId, "195338");
            assert.equal(picked.preview.product.variants[1].price, 52500);
        }
        const forged = await previewMastershopProduct("88597", "424242", fetchImpl);
        assert.ok("error" in forged);
    } finally {
        clearEnv();
    }
});

// --- account membership ------------------------------------------------------

test("membership: 404 is false; valid single match is true", async () => {
    env();
    try {
        const notFound: FetchLike = async () => new Response("{}", { status: 404 });
        const res404 = await mastershopProductBelongsToAccount("88597", notFound);
        assert.deepEqual(res404, { ok: true, data: false });

        const found: FetchLike = async (url) => {
            assert.equal(
                String(url),
                "https://prod.api.mastershop.com/api/products/88597?includeAllVariations=true"
            );
            return new Response(
                JSON.stringify({ results: [{ idProduct: 88597, name: "x", baseCurrencyPrice: "COP" }] }),
                { status: 200 }
            );
        };
        const resOk = await mastershopProductBelongsToAccount("88597", found);
        assert.deepEqual(resOk, { ok: true, data: true });
    } finally {
        clearEnv();
    }
});

test("membership: mismatched id or malformed envelope is an error, never false", async () => {
    env();
    try {
        const mismatch: FetchLike = async () =>
            new Response(JSON.stringify({ results: [{ idProduct: 999 }] }), { status: 200 });
        const resMismatch = await mastershopProductBelongsToAccount("88597", mismatch);
        assert.equal(resMismatch.ok, false);

        const malformed: FetchLike = async () =>
            new Response(JSON.stringify({ results: [] }), { status: 200 });
        const resMalformed = await mastershopProductBelongsToAccount("88597", malformed);
        assert.equal(resMalformed.ok, false);

        const noResults: FetchLike = async () =>
            new Response(JSON.stringify({ data: [] }), { status: 200 });
        const resNoResults = await mastershopProductBelongsToAccount("88597", noResults);
        assert.equal(resNoResults.ok, false);
    } finally {
        clearEnv();
    }
});
