import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import type { FakeRow } from "./fakeSupabase.ts";
import type { FetchLike } from "../lib/trends/http.ts";
import {
    buildSupplierImport,
    supplierPricing,
} from "../lib/catalog/supplierImport.ts";
import type { SupplierPreview, ImportSource } from "../lib/catalog/supplierImport.ts";
import {
    lookupSupplierPreview,
    parseSupplierProductId,
    validateImportBody,
    validatePreviewBody,
} from "../lib/suppliers/importService.ts";
import { refreshSupplierProduct, importDraft } from "../lib/catalog/repository.ts";
import type { CatalogRow } from "../lib/catalog/validate.ts";

// --- Input parsing / SSRF guard ---------------------------------------------

test("supplier product id parsing accepts raw ids and official URLs only", () => {
    assert.equal(parseSupplierProductId("aliexpress_ds", "1005001234567890"), "1005001234567890");
    assert.equal(
        parseSupplierProductId("aliexpress_ds", "https://www.aliexpress.com/item/1005001234567890.html"),
        "1005001234567890"
    );
    assert.equal(
        parseSupplierProductId("aliexpress_ds", "https://es.aliexpress.com/item/12345678901.html?x=1"),
        "12345678901"
    );
    // hostile lookalike hosts and schemes rejected
    assert.equal(parseSupplierProductId("aliexpress_ds", "https://aliexpress.com.evil.com/item/12345678901.html"), null);
    assert.equal(parseSupplierProductId("aliexpress_ds", "https://evilaliexpress.com/item/12345678901.html"), null);
    assert.equal(parseSupplierProductId("aliexpress_ds", "javascript:alert(1)"), null);
    assert.equal(parseSupplierProductId("aliexpress_ds", "ftp://aliexpress.com/item/12345678901.html"), null);
    assert.equal(parseSupplierProductId("aliexpress_ds", "https://ali.express/abc"), null); // shorteners unsupported
    // CJ ids and urls
    assert.equal(parseSupplierProductId("cjdropshipping", "PID-abc_1"), "PID-abc_1");
    assert.equal(
        parseSupplierProductId("cjdropshipping", "https://cjdropshipping.com/product/lamp-p-PID-9.html"),
        "PID-9"
    );
    assert.equal(
        parseSupplierProductId("cjdropshipping", "https://www.cjdropshipping.com/x.html?pid=PID-8"),
        "PID-8"
    );
    assert.equal(parseSupplierProductId("cjdropshipping", "https://cj.evil.com/p-pid.html"), null);
    assert.equal(parseSupplierProductId("aliexpress_ds", "x".repeat(3000)), null);
    // Mastershop accepts raw numeric ids only — URLs and non-numeric input rejected
    assert.equal(parseSupplierProductId("mastershop", "88597"), "88597");
    assert.equal(parseSupplierProductId("mastershop", "https://app.mastershop.com/products/market/88597"), null);
    assert.equal(parseSupplierProductId("mastershop", "MS-1"), null);
    assert.equal(parseSupplierProductId("mastershop", "0"), null);
});

test("request body validation is strict and ignores client-supplied supplier data", () => {
    assert.ok("error" in validatePreviewBody(null));
    assert.ok("error" in validatePreviewBody({ source: "aliexpress", productId: "1" }));
    assert.ok("error" in validatePreviewBody({ source: "aliexpress_ds", productId: 5 }));
    // Research-only sources are rejected before any provider access
    assert.ok("error" in validatePreviewBody({ source: "aliexpress_ds", productId: "1005001234567890" }));
    assert.ok("error" in validatePreviewBody({ source: "cjdropshipping", productId: "PID-1" }));
    const ok = validatePreviewBody({ source: "mastershop", productId: "12345", variantId: "V-1" });
    assert.ok(!("error" in ok) && ok.productId === "12345" && ok.variantId === "V-1");
    const okMs = validatePreviewBody({ source: "mastershop", productId: "88597", variantId: "195338" });
    assert.ok(!("error" in okMs) && okMs.source === "mastershop" && okMs.productId === "88597");
    assert.ok("error" in validatePreviewBody({ source: "mastershop", productId: "MS-1" }));

    // forged client fields cannot flow into the validated request
    const forged = validateImportBody({
        source: "mastershop",
        productId: "12345",
        variantId: "V-1",
        freightId: null,
        marginPercent: 20,
        priceCop: 999,
        title: "forged",
        stock: 9999,
        supplierCostCop: 1,
        images: ["https://evil.example.com/x.jpg"],
    });
    assert.ok(!("error" in forged));
    if (!("error" in forged)) {
        assert.deepEqual(Object.keys(forged).sort(), [
            "freightId", "marginPercent", "priceCop", "productId", "source", "variantId",
        ]);
        assert.equal(forged.priceCop, 999);
    }
    assert.ok("error" in validateImportBody({ source: "mastershop", productId: "12345", marginPercent: 20 }));
    assert.ok("error" in validateImportBody({
        source: "mastershop", productId: "12345", variantId: "V-1",
        freightId: null, marginPercent: 20, priceCop: "abc",
    }));
    assert.ok("error" in validateImportBody({
        source: "cjdropshipping", productId: "PID-1", variantId: "V-1",
        freightId: null, marginPercent: 20,
    }));
});

// --- buildSupplierImport field mapping ---------------------------------------

function previewFixture(overrides: Partial<SupplierPreview> = {}): SupplierPreview {
    return {
        product: {
            source: "mastershop",
            productId: "12345",
            title: "Lámpara",
            description: "Una lámpara",
            category: "Iluminación",
            images: ["https://img.example.com/l.jpg"],
            sourceUrl: null,
            variants: [
                {
                    id: "V-1",
                    label: "Blanca",
                    price: 40000,
                    currency: "COP",
                    stock: 7,
                    image: null,
                    attributes: { sku: "DROP-W", suggested_price: 89000 },
                },
            ],
            details: { type: "VARIABLE", suggested_price: 89000 },
            fetchedAt: "2025-01-01T00:00:00.000Z",
        },
        selectedVariantId: "V-1",
        freight: [],
        freightDestination: "Colombia — cotización pendiente",
        freightCheckedAt: null,
        fx: null,
        warnings: [],
        ...overrides,
    };
}

test("buildSupplierImport rejects research-only sources under the sourcing policy", () => {
    const research = previewFixture();
    research.product = { ...research.product, source: "cjdropshipping" };
    const result = buildSupplierImport(research, { marginPercent: 20, freightId: null }, "a");
    assert.ok("error" in result && result.error.includes("investigación"));
});

test("buildSupplierImport maps Mastershop COP cost without shipping or FX", () => {
    const result = buildSupplierImport(
        previewFixture(),
        { marginPercent: 20, freightId: null, priceCop: 89000 },
        "admin-1"
    );
    assert.ok(!("error" in result));
    if ("error" in result) return;
    // Supplier cost is already COP — populated directly, no FX needed.
    assert.equal(result.fields!.supplier_cost_cop, 40000);
    assert.equal(result.fields!.supplier_shipping_cop, null);
    assert.equal(result.fields!.customer_shipping_cop, null);
    assert.equal(result.fields!.price_cop, 89000);
    assert.equal(result.fields!.fx_rate, null);
    assert.equal(result.fields!.stock, 7);
    assert.equal(result.providerItemId, "12345-V-1");
    const sv = result.supplierVariant as Record<string, unknown>;
    assert.equal(sv.product_id, "12345");
    assert.equal(sv.variation_id, "V-1");
    assert.equal(sv.provider_stock, 7);
    assert.equal(sv.price_provisional, true);
});

test("buildSupplierImport maps Mastershop COP snapshot with variation_id", () => {
    const preview = previewFixture();
    preview.product = {
        ...preview.product,
        source: "mastershop",
        productId: "88597",
        sourceUrl: "https://app.mastershop.com/products/market/88597",
        variants: [
            {
                id: "195338",
                label: "Negro",
                price: 52500,
                currency: "COP",
                stock: 497,
                image: null,
                attributes: { sku: null, suggested_price: 95500 },
            },
        ],
        details: { suggested_price: 95500, provider_name: "Proveedor Uno" },
    };
    preview.selectedVariantId = "195338";
    const result = buildSupplierImport(
        preview,
        { marginPercent: 20, freightId: null, priceCop: 95500 },
        "admin-1"
    );
    assert.ok(!("error" in result));
    if ("error" in result) return;
    assert.equal(result.source, "mastershop");
    assert.equal(result.providerItemId, "88597-195338");
    assert.equal(result.fields!.supplier_cost_cop, 52500);
    assert.equal(result.fields!.supplier_shipping_cop, null);
    assert.equal(result.fields!.stock, 497);
    assert.equal(result.fields!.fx_rate, null);
    const sv = result.supplierVariant as Record<string, unknown>;
    assert.equal(sv.product_id, "88597");
    assert.equal(sv.variation_id, "195338");
    assert.equal(sv.provider_stock, 497);
    assert.equal(sv.provider_price, 52500);
});

test("buildSupplierImport without a selling price leaves price 0, shipping pending", () => {
    const result = buildSupplierImport(
        previewFixture(),
        { marginPercent: 20, freightId: null },
        "admin-1"
    );
    assert.ok(!("error" in result));
    if ("error" in result) return;
    assert.equal(result.fields!.supplier_cost_cop, 40000);
    assert.equal(result.fields!.supplier_shipping_cop, null);
    // No fake suggestion: shipping is unknown so price stays 0 for review.
    assert.equal(result.fields!.price_cop, 0);
    assert.equal(result.fields!.fx_rate, null);
});

test("buildSupplierImport requires a selected variant among multiple", () => {
    const preview = previewFixture();
    preview.product.variants.push({
        id: "V-2", label: "Black", price: 11, currency: "USD",
        stock: 1, image: null, attributes: {},
    });
    const noSel = buildSupplierImport(
        { ...preview, selectedVariantId: null },
        { marginPercent: 20, freightId: null },
        "admin-1"
    );
    assert.ok("error" in noSel);
    const stale = buildSupplierImport(
        previewFixture({ selectedVariantId: "GONE" }),
        { marginPercent: 20, freightId: null },
        "admin-1"
    );
    assert.ok("error" in stale);
    // A stale freight identity is still rejected even though Mastershop has no
    // freight options — the client can't reference a removed quote.
    const staleFreight = buildSupplierImport(
        previewFixture(),
        { marginPercent: 20, freightId: "OLD-OPTION" },
        "admin-1"
    );
    assert.ok("error" in staleFreight);
});

test("unknown stock imports as 0 while a real 0 is preserved", () => {
    const unknown = previewFixture();
    unknown.product.variants[0].stock = null;
    const r1 = buildSupplierImport(unknown, { marginPercent: 20, freightId: null }, "a");
    assert.ok(!("error" in r1));
    if (!("error" in r1)) assert.equal(r1.fields!.stock, 0);

    const zero = previewFixture();
    zero.product.variants[0].stock = 0;
    const r2 = buildSupplierImport(zero, { marginPercent: 20, freightId: null }, "a");
    assert.ok(!("error" in r2));
    if (!("error" in r2)) {
        assert.equal(r2.fields!.stock, 0);
        assert.equal((r2.supplierVariant as Record<string, unknown>).provider_stock, 0);
    }
});

test("margin and price bounds enforced", () => {
    assert.ok("error" in buildSupplierImport(previewFixture(), { marginPercent: 10, freightId: null }, "a"));
    assert.ok("error" in buildSupplierImport(previewFixture(), { marginPercent: 60, freightId: null }, "a"));
    assert.ok(
        "error" in
            buildSupplierImport(previewFixture(), { marginPercent: 20, freightId: null, priceCop: -5 }, "a")
    );
});

test("supplierPricing resolves a Mastershop COP variant; no shipping, no suggestion", () => {
    const preview = previewFixture();
    const p = supplierPricing(preview, { marginPercent: 20, freightId: null });
    assert.equal(p.variant?.id, "V-1");
    assert.equal(p.cost, 40000);
    assert.equal(p.shipping, null);
    assert.equal(p.suggestion, null); // no fake zero-shipping suggestion
});

// --- importDraft idempotency --------------------------------------------------

test("duplicate supplier import returns the existing draft without overwriting", async () => {
    const db = new FakeDb();
    db.unique.catalog_products = [["source", "provider_item_id"]];
    const input = buildSupplierImport(
        previewFixture(),
        { marginPercent: 20, freightId: null, priceCop: 89000 },
        "admin-1"
    );
    assert.ok(!("error" in input));
    if ("error" in input) return;
    const first = await importDraft(input, db.asClient());
    assert.ok("created" in first && first.created);
    const before = db.tables.catalog_products.find((r) => r.id === first.id)!;
    before.name = "Edited by operator";
    const second = await importDraft(input, db.asClient());
    assert.ok("created" in second && second.created === false && second.id === first.id);
    assert.equal(db.tables.catalog_products.length, 1);
    assert.equal(before.name, "Edited by operator");
});

// --- refreshSupplierProduct ---------------------------------------------------

function catalogRow(overrides: Partial<CatalogRow> = {}): FakeRow {
    return {
        id: "prod-1",
        source: "mastershop",
        provider_item_id: "12345-V-1",
        status: "published",
        name: "Lámpara",
        price_cop: 90000,
        stock: 3,
        description: "orig",
        images: ["https://img.example.com/x.jpg"],
        category: "Iluminación",
        room: "sala",
        type: "lampara",
        listing_price: 40000,
        listing_currency: "COP",
        supplier_cost_cop: 40000,
        supplier_shipping_cop: null,
        customer_shipping_cop: 12000,
        taxes_fees_cop: null,
        price_note: null,
        discount_pct: null,
        currency_code: "COP",
        shipping_estimate_city: "Colombia",
        shipping_checked_at: "2025-01-01T00:00:00.000Z",
        fx_rate: null,
        fx_rate_date: null,
        supplier_rights_confirmed: true,
        supplier_variant: { product_id: "12345", variation_id: "V-1" },
        source_url: null,
        created_by: "admin-1",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-06-01T00:00:00.000Z",
        ...overrides,
    } as unknown as FakeRow;
}

function syncLookup(preview: SupplierPreview | null) {
    return async () =>
        preview
            ? { preview }
            : { error: "provider unreachable" };
}

test("supplier sync rejects stale timestamp and archived rows without writes", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow()];
    const lookup = syncLookup(previewFixture());
    const stale = await refreshSupplierProduct("prod-1", "2000-01-01T00:00:00.000Z", db.asClient(), lookup);
    assert.ok("error" in stale && /changed during review/.test(stale.error));

    db.tables.catalog_products = [catalogRow({ status: "archived" })];
    const archived = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), lookup);
    assert.ok("error" in archived);
    assert.equal(db.ops.filter((o) => o.kind === "update").length, 0);
});

test("supplier sync rejects non-supplier sources and missing variant data", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow({ source: "manual", supplier_variant: null })];
    const r1 = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), syncLookup(previewFixture()));
    assert.ok("error" in r1);

    db.tables.catalog_products = [catalogRow({ supplier_variant: {} })];
    const r2 = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), syncLookup(previewFixture()));
    assert.ok("error" in r2);

    // provider no longer returns the stored variant → real lookup errors
    db.tables.catalog_products = [catalogRow()];
    // Emulate the real lookup's contract: a stored vid no longer offered by the
    // provider is rejected instead of silently matching another variant.
    const lookupMissingVariant = async (
        _s: unknown,
        _source: ImportSource,
        _pid: string,
        variantId?: string
    ) => {
        const preview = previewFixture();
        preview.product.variants = [
            { id: "V-9", label: "x", price: 1000, currency: "COP", stock: 5, image: null, attributes: {} },
        ];
        preview.selectedVariantId = "V-9";
        if (variantId && !preview.product.variants.some((v) => v.id === variantId)) {
            return { error: "la variante seleccionada no pertenece a este producto" };
        }
        return { preview };
    };
    const r3 = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), lookupMissingVariant);
    assert.ok("error" in r3);
    assert.equal(db.tables.catalog_products[0].stock, 3);
});

test("supplier sync refuses unverifiable stock or cost and writes nothing", async () => {
    const db = new FakeDb();
    const noStock = previewFixture();
    noStock.product.variants[0].stock = null;
    db.tables.catalog_products = [catalogRow()];
    const r1 = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), syncLookup(noStock));
    assert.ok("error" in r1);
    assert.equal(db.tables.catalog_products[0].stock, 3);

    // Mastershop cost needs no FX, but a missing variant price still blocks sync.
    const noPrice = previewFixture();
    noPrice.product.variants[0].price = null;
    db.tables.catalog_products = [catalogRow()];
    const r2 = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), syncLookup(noPrice));
    assert.ok("error" in r2);
    assert.equal(db.tables.catalog_products[0].supplier_cost_cop, 40000);
});

test("supplier sync updates stock/cost only and warns on freight gaps", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow()];
    const preview = previewFixture();
    preview.product.variants[0].price = 48000; // new supplier cost COP
    preview.product.variants[0].stock = 55;
    const result = await refreshSupplierProduct(
        "prod-1",
        "2025-06-01T00:00:00.000Z",
        db.asClient(),
        syncLookup(preview)
    );
    assert.ok("ok" in result && result.ok);
    if (!("ok" in result)) return;
    assert.ok(result.warnings.some((w) => w.includes("envío")));
    const row = db.tables.catalog_products[0];
    assert.equal(row.stock, 55);
    assert.equal(row.supplier_cost_cop, 48000);
    assert.equal(row.listing_price, 48000);
    assert.equal(row.listing_currency, "COP");
    // untouched fields
    assert.equal(row.price_cop, 90000);
    assert.equal(row.name, "Lámpara");
    assert.equal(row.supplier_rights_confirmed, true);
    assert.equal(row.customer_shipping_cop, 12000);
    const sv = row.supplier_variant as Record<string, unknown>;
    assert.equal(sv.provider_stock, 55);
    assert.equal(sv.product_id, "12345");
});

test("supplier sync refreshes Mastershop rows via variation_id and keeps operator fields", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({
            source: "mastershop",
            provider_item_id: "88597-195338",
            supplier_variant: { product_id: "88597", variation_id: "195338" },
        }),
    ];
    const preview = previewFixture();
    preview.product = { ...preview.product, source: "mastershop", productId: "88597" };
    preview.product.variants = [
        {
            id: "195338",
            label: "Negro",
            price: 61000,
            currency: "COP",
            stock: 120,
            image: null,
            attributes: { sku: null, suggested_price: 95500 },
        },
    ];
    preview.selectedVariantId = "195338";
    const result = await refreshSupplierProduct(
        "prod-1",
        "2025-06-01T00:00:00.000Z",
        db.asClient(),
        syncLookup(preview)
    );
    assert.ok("ok" in result && result.ok);
    const row = db.tables.catalog_products[0];
    assert.equal(row.stock, 120);
    assert.equal(row.supplier_cost_cop, 61000);
    // operator-edited price and content are preserved
    assert.equal(row.price_cop, 90000);
    assert.equal(row.name, "Lámpara");
    const sv = row.supplier_variant as Record<string, unknown>;
    assert.equal(sv.variation_id, "195338");
    assert.equal(sv.provider_stock, 120);
});

test("supplier sync reports conflict when row changed between read and write", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow()];
    // simulate a concurrent edit: bump updated_at inside the lookup call
    // Replace (not mutate) the stored row so the object the sync read keeps
    // its snapshot of updated_at — mirroring a real concurrent write.
    const lookup = async () => {
        const current = db.tables.catalog_products[0];
        db.tables.catalog_products[0] = { ...current, updated_at: "2025-06-01T00:00:01.000Z" };
        return { preview: previewFixture() };
    };
    const result = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), lookup);
    assert.ok("error" in result && /changed during review/.test(result.error));
    assert.equal(db.tables.catalog_products[0].stock, 3); // not overwritten
});

// --- Full CJ preview flow with mocked HTTP -----------------------------------

function cjPreviewEnv() {
    process.env.CJ_API_KEY = "cj-key-1";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
}
function clearCjPreviewEnv() {
    delete process.env.CJ_API_KEY;
    delete process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
}

function cjHttpFixtures(opts: { failFreight?: boolean; staleFx?: boolean } = {}): FetchLike {
    const fxUpdated = opts.staleFx
        ? Math.floor(Date.now() / 1000) - 80 * 3600 // >72h old → rejected
        : Math.floor(Date.now() / 1000);
    return async (url) => {
        const u = String(url);
        if (u.includes("authentication/getAccessToken")) {
            return new Response(JSON.stringify({
                code: 200,
                result: true,
                data: {
                    accessToken: "cj-token-1",
                    accessTokenExpiryDate: new Date(Date.now() + 86400_000).toISOString(),
                    refreshToken: "r",
                    refreshTokenExpiryDate: new Date(Date.now() + 8640000_00).toISOString(),
                },
            }), { status: 200 });
        }
        if (u.includes("/product/query")) {
            return new Response(JSON.stringify({
                code: 200,
                result: true,
                data: {
                    pid: "PID-1",
                    productNameEn: "Lamp",
                    productImageSet: ["https://img.example.com/l.jpg"],
                    variants: [{ vid: "V-1", variantSellPrice: "10.00", inventories: [{ countryCode: "CN", totalInventory: 5 }] }],
                },
            }), { status: 200 });
        }
        if (u.includes("stock/queryByVid")) {
            return new Response(JSON.stringify({
                code: 200,
                result: true,
                // documented flat per-country rows; nested warehouse stock ignored
                data: [{
                    vid: "V-1",
                    countryCode: "CN",
                    totalInventoryNum: 5,
                    cjInventoryNum: 2,
                    factoryInventoryNum: 3,
                    stock: [{ stockId: "w1", inventory: 0, factoryInventory: 999 }],
                }],
            }), { status: 200 });
        }
        if (u.includes("freightCalculate")) {
            if (opts.failFreight) {
                return new Response(JSON.stringify({ code: 500, result: false }), { status: 200 });
            }
            return new Response(JSON.stringify({
                code: 200,
                result: true,
                data: [{ logisticName: "CJ Packet", totalPostageFee: 2, logisticAging: "10-15" }],
            }), { status: 200 });
        }
        if (u.includes("open.er-api.com")) {
            return new Response(JSON.stringify({
                result: "success",
                base_code: "USD",
                time_last_update_unix: fxUpdated,
                rates: { COP: 4000 },
            }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${u}`);
    };
}

test("lookupSupplierPreview rejects research-only sources before any provider call", async () => {
    cjPreviewEnv();
    try {
        const db = new FakeDb();
        let fetches = 0;
        const counting: FetchLike = async (url) => {
            fetches++;
            return cjHttpFixtures()(url);
        };
        const ds = await lookupSupplierPreview(
            db.asClient(), "aliexpress_ds", "1005001234567890", undefined, counting
        );
        assert.ok("error" in ds && ds.error.includes("investigación"));
        const cj = await lookupSupplierPreview(
            db.asClient(), "cjdropshipping", "PID-1", undefined, counting
        );
        assert.ok("error" in cj && cj.error.includes("investigación"));
        assert.equal(fetches, 0); // policy gate runs before provider access
    } finally {
        clearCjPreviewEnv();
    }
});

test("research CJ pipeline still assembles a complete preview via lookupCjPreview", async () => {
    cjPreviewEnv();
    try {
        const { lookupCjPreview } = await import("../lib/suppliers/importService.ts");
        const db = new FakeDb();
        const result = await lookupCjPreview(
            db.asClient(), "PID-1", undefined, cjHttpFixtures()
        );
        assert.ok("preview" in result);
        if (!("preview" in result)) return;
        const p = result.preview;
        assert.equal(p.product.productId, "PID-1");
        assert.equal(p.selectedVariantId, "V-1");
        assert.equal(p.product.variants[0].stock, 5);
        assert.equal(p.freight[0].feeUsd, 2);
        assert.equal(p.fx?.rate, 4000);
        // lease released even on success
        assert.equal(db.leases.size, 0);
        // ...but the research preview cannot build an import
        const draft = buildSupplierImport(p, { marginPercent: 20, freightId: null }, "admin-1");
        assert.ok("error" in draft && draft.error.includes("investigación"));
    } finally {
        clearCjPreviewEnv();
    }
});

test("research CJ freight failure still degrades to warnings", async () => {
    cjPreviewEnv();
    try {
        const { lookupCjPreview } = await import("../lib/suppliers/importService.ts");
        const db = new FakeDb();
        const result = await lookupCjPreview(
            db.asClient(), "PID-1", undefined, cjHttpFixtures({ failFreight: true })
        );
        assert.ok("preview" in result);
        if (!("preview" in result)) return;
        assert.equal(result.preview.freight.length, 0);
        assert.ok(result.preview.warnings.some((w) => w.includes("envío")));
    } finally {
        clearCjPreviewEnv();
    }
});

test("research CJ stale FX is rejected and conversion is skipped", async () => {
    cjPreviewEnv();
    try {
        const { lookupCjPreview } = await import("../lib/suppliers/importService.ts");
        const db = new FakeDb();
        const result = await lookupCjPreview(
            db.asClient(), "PID-1", undefined, cjHttpFixtures({ staleFx: true })
        );
        assert.ok("preview" in result);
        if (!("preview" in result)) return;
        assert.equal(result.preview.fx, null);
        assert.ok(result.preview.warnings.some((w) => w.includes("USD→COP")));
    } finally {
        clearCjPreviewEnv();
    }
});

test("research CJ explicit variantId that does not belong is rejected", async () => {
    cjPreviewEnv();
    try {
        const { lookupCjPreview } = await import("../lib/suppliers/importService.ts");
        const db = new FakeDb();
        const result = await lookupCjPreview(
            db.asClient(), "PID-1", "NOT-A-VARIANT", cjHttpFixtures()
        );
        assert.ok("error" in result);
    } finally {
        clearCjPreviewEnv();
    }
});

test("import body enforces margin/price bounds; research sources rejected", () => {
    const base = { source: "mastershop" as const, productId: "12345", variantId: "V-1", freightId: null };
    assert.ok("error" in validateImportBody({ ...base, marginPercent: 14 }));
    assert.ok("error" in validateImportBody({ ...base, marginPercent: 51 }));
    assert.ok("error" in validateImportBody({ ...base, marginPercent: 20, priceCop: 2147483648 }));
    assert.ok("error" in validateImportBody({ ...base, marginPercent: 20, priceCop: 0 }));
    assert.ok("error" in validateImportBody({ ...base, productId: "PID-1", marginPercent: 20 })); // non-numeric mastershop id
    // research sources rejected no matter how well-formed
    assert.ok("error" in validateImportBody({
        ...base, source: "cjdropshipping", productId: "PID-1", marginPercent: 20,
    }));
    // aliexpress URL id must pass isValidDsProductId — short digit runs rejected
    assert.equal(parseSupplierProductId("aliexpress_ds", "https://www.aliexpress.com/item/123.html"), null);
});

test("supplier sync aborts before lookup when stored variant id is missing", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow({ supplier_variant: { product_id: "PID-1" } })];
    let calls = 0;
    const lookup = async () => {
        calls++;
        return { preview: previewFixture() };
    };
    const result = await refreshSupplierProduct("prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), lookup);
    assert.ok("error" in result);
    assert.equal(calls, 0);
});

test("supplier sync rejects a provider snapshot that mismatches the stored ids", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow()];
    const mismatched = previewFixture();
    mismatched.selectedVariantId = "OTHER";
    const result = await refreshSupplierProduct(
        "prod-1", "2025-06-01T00:00:00.000Z", db.asClient(), syncLookup(mismatched)
    );
    assert.ok("error" in result);
    assert.equal(db.tables.catalog_products[0].stock, 3);
});

test("cj detail call with an expired deadline performs no provider fetch", async () => {
    const { fetchCjProductDetail } = await import("../lib/suppliers/cjCatalog.ts");
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return new Response("{}", { status: 200 });
    };
    const result = await fetchCjProductDetail("tok", "PID-1", fetchImpl, Date.now() - 1000);
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
});
