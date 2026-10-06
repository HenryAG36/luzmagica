import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildDraftId,
    buildDraftInsert,
    estimateMarginCOP,
    isValidProviderItemId,
    sanitizeImportFields,
    sanitizeReviewFields,
    toPublicProduct,
    validatePublishable,
} from "../lib/catalog/validate.ts";
import type { CatalogRow, PublicProductRow } from "../lib/catalog/validate.ts";
import { FakeDb } from "./fakeSupabase.ts";
import type { FakeRow } from "./fakeSupabase.ts";
import {
    archiveProduct,
    listCatalogProducts,
    publishCatalogProduct,
    updateProduct,
} from "../lib/catalog/repository.ts";

test("draft ids are deterministic per provider item for idempotent import", () => {
    assert.equal(buildDraftId("mercadolibre", "MCO123"), "imp-mercadolibre-MCO123");
    assert.equal(buildDraftId("aliexpress", "1005001"), "imp-aliexpress-1005001");
    assert.equal(buildDraftId("aliexpress", "a/b"), "imp-aliexpress-a/b");
});

test("provider item ids are restricted to a safe allowlist", () => {
    assert.equal(isValidProviderItemId("MCO123"), true);
    assert.equal(isValidProviderItemId("a/b"), false);
    assert.equal(isValidProviderItemId(""), false);
    assert.equal(isValidProviderItemId(null), false);
    assert.equal(isValidProviderItemId("x".repeat(200)), false);
});

test("review fields reject malformed and dangerous input", () => {
    assert.ok(sanitizeReviewFields(null).errors.length > 0);
    assert.ok(sanitizeReviewFields("x").errors.length > 0);
    assert.ok(sanitizeReviewFields({ price_cop: -5 }).errors.includes("invalid field: price_cop"));
    assert.ok(sanitizeReviewFields({ price_cop: 1.5 }).errors.includes("invalid field: price_cop"));
    assert.ok(sanitizeReviewFields({ unknown: 1 }).errors.includes("unknown field: unknown"));
    assert.ok(
        sanitizeReviewFields({ images: ["javascript:alert(1)"] }).errors.includes("invalid field: images")
    );
    assert.equal(sanitizeReviewFields({ name: "ok", stock: 3 }).errors.length, 0);
});

test("optional room/type accept empty and whitespace but reject nonstrings and overflow", () => {
    const ok = sanitizeReviewFields({ room: "", type: "   " });
    assert.equal(ok.errors.length, 0);
    assert.equal(ok.fields.room, "");
    assert.equal(ok.fields.type, "");
    assert.ok(sanitizeReviewFields({ room: 5 }).errors.includes("invalid field: room"));
    assert.ok(
        sanitizeReviewFields({ type: "x".repeat(81) }).errors.includes("invalid field: type")
    );
    const publishable = {
        name: "n",
        category: "c",
        description: "d",
        images: ["https://x.test/a.jpg"],
        price_cop: 1,
        stock: 1,
        supplier_rights_confirmed: true,
    };
    assert.equal(validatePublishable(publishable).valid, true);
    assert.ok(validatePublishable({ ...publishable, description: "" }).missing.includes("description"));
    assert.ok(validatePublishable({ ...publishable, category: "" }).missing.includes("category"));
});

test("imported drafts always start unpublished with stock zero", () => {
    const draft = buildDraftInsert({
        source: "mercadolibre",
        providerItemId: "MCO1",
        title: "Lamp",
        createdBy: "admin-1",
    });
    assert.equal(draft.status, "draft");
    assert.equal(draft.stock, 0);
    assert.equal(draft.price_cop, 0);
});

test("publication requires reviewed fields", () => {
    const base = {
        name: "Lamp",
        category: "lamparas",
        description: "desc",
        images: ["https://x.test/a.jpg"],
        price_cop: 50000,
        stock: 5,
        supplier_rights_confirmed: true,
    };
    assert.equal(validatePublishable(base).valid, true);
    assert.deepEqual(validatePublishable({ ...base, stock: 0 }).missing, ["stock"]);
    assert.deepEqual(validatePublishable({ ...base, price_cop: 0 }).missing, ["price_cop"]);
    assert.deepEqual(validatePublishable({ ...base, images: [] }).missing, ["images"]);
    assert.ok(validatePublishable({ ...base, description: "  " }).missing.includes("description"));
    assert.ok(
        validatePublishable({ ...base, supplier_rights_confirmed: false }).missing.includes(
            "supplier_rights_confirmed"
        )
    );
});

test("public product projection excludes supplier cost fields", () => {
    const row: PublicProductRow = {
        id: "1",
        name: "Lamp",
        price_cop: 100,
        original_price_cop: null,
        category: "lamparas",
        room: "sala",
        images: [],
        badge: "new",
        description: "d",
        stock: 3,
        type: "lampara",
        customer_shipping_cop: 9000,
        shipping_estimate_city: "Bogotá",
        shipping_checked_at: "2026-10-07T00:00:00.000Z",
        shipping_quote_required: true,
    };
    const product = toPublicProduct(row) as unknown as Record<string, unknown>;
    assert.equal(product.shippingEstimateCOP, 9000);
    assert.equal(product.shippingQuoteRequired, true);
    assert.equal(product.price, 100);
    for (const key of Object.keys(product)) {
        assert.ok(!key.includes("supplier"), `leaked field ${key}`);
        assert.ok(!key.includes("cost"), `leaked field ${key}`);
    }
});

test("margin requires explicit cost components", () => {
    assert.equal(
        estimateMarginCOP({ priceCop: 100, supplierCostCop: 40, shippingCop: 10, taxesFeesCop: 5 }),
        45
    );
    assert.equal(
        estimateMarginCOP({ priceCop: 100, supplierCostCop: null, shippingCop: 10, taxesFeesCop: 5 }),
        null
    );
});

test("import fields are allowlisted to pricing/shipping columns only", () => {
    const ok = sanitizeImportFields({
        price_cop: 24412,
        supplier_cost_cop: 20000,
        supplier_shipping_cop: 5000,
        customer_shipping_cop: 5000,
        fx_rate: 4200,
        fx_rate_date: "2026-10-07",
        shipping_estimate_city: "Bogotá",
        shipping_checked_at: "2026-10-07T12:00:00.000Z",
    });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.fields.price_cop, 24412);
    assert.equal(ok.fields.shipping_checked_at, "2026-10-07T12:00:00.000Z");

    const bad = sanitizeImportFields({ stock: 99, description: "x", supplier_rights_confirmed: true });
    assert.deepEqual(bad.fields, {});
    assert.equal(bad.errors.length, 3);

    const invalid = sanitizeImportFields({ customer_shipping_cop: -1, fx_rate: 0 });
    assert.equal(invalid.fields.customer_shipping_cop, undefined);
    assert.equal(invalid.errors.length, 2);
});

// ---------- management repository + international publish guard ----------

function catalogRow(overrides: Partial<CatalogRow> = {}): FakeRow {
    return {
        id: "prod-1",
        source: "aliexpress_ds",
        provider_item_id: "1001",
        source_url: null,
        name: "Lamp",
        price_cop: 10000,
        original_price_cop: null,
        category: "lamparas",
        room: "",
        images: ["https://x.test/a.jpg"],
        badge: null,
        description: "desc",
        stock: 5,
        type: "",
        listing_price: null,
        listing_currency: null,
        supplier_cost_cop: null,
        supplier_shipping_cop: null,
        taxes_fees_cop: null,
        fx_rate: null,
        fx_rate_date: null,
        supplier_rights_confirmed: true,
        supplier_variant: null,
        customer_shipping_cop: 5000,
        shipping_estimate_city: "Bogotá",
        shipping_checked_at: "2026-10-07T00:00:00.000Z",
        status: "draft",
        reviewed_by: null,
        published_at: null,
        updated_at: "2026-10-01T00:00:00.000Z",
        created_at: "2026-10-01T00:00:00.000Z",
        ...overrides,
    };
}

test("international sources require confirmed customer shipping to publish", () => {
    const base = {
        name: "Lamp",
        category: "lamparas",
        description: "desc",
        images: ["https://x.test/a.jpg"],
        price_cop: 50000,
        stock: 5,
        supplier_rights_confirmed: true,
    };

    const missingAll = validatePublishable({ ...base, source: "aliexpress_ds" });
    assert.equal(missingAll.valid, false);
    for (const f of ["customer_shipping_cop", "shipping_estimate_city", "shipping_checked_at"]) {
        assert.ok(missingAll.missing.includes(f), `expected ${f} missing`);
    }

    // explicit 0 (known free) is accepted; null is not
    assert.equal(
        validatePublishable({
            ...base,
            source: "aliexpress_ds",
            customer_shipping_cop: 0,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "2026-10-07T00:00:00.000Z",
        }).valid,
        true
    );
    assert.ok(
        validatePublishable({
            ...base,
            source: "cjdropshipping",
            customer_shipping_cop: null,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "2026-10-07T00:00:00.000Z",
        }).missing.includes("customer_shipping_cop")
    );
    assert.ok(
        validatePublishable({
            ...base,
            source: "aliexpress_ds",
            customer_shipping_cop: 5000,
            shipping_estimate_city: "   ",
            shipping_checked_at: "2026-10-07T00:00:00.000Z",
        }).missing.includes("shipping_estimate_city")
    );
    assert.ok(
        validatePublishable({
            ...base,
            source: "aliexpress_ds",
            customer_shipping_cop: 5000,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "not-a-date",
        }).missing.includes("shipping_checked_at")
    );

    // domestic sources are unaffected
    assert.equal(validatePublishable({ ...base, source: "mercadolibre" }).valid, true);
});

test("listCatalogProducts returns every status and surfaces errors", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({ id: "a", status: "draft" }),
        catalogRow({ id: "b", status: "published" }),
        catalogRow({ id: "c", status: "archived" }),
    ];
    const res = await listCatalogProducts(db.asClient());
    assert.ok("products" in res);
    if (!("products" in res)) return;
    assert.equal(res.products.length, 3);

    const dbErr = new FakeDb();
    dbErr.failSelects.add("catalog_products");
    const bad = await listCatalogProducts(dbErr.asClient());
    assert.ok("error" in bad, "select errors must not be masked as an empty list");
});

test("updateProduct guards published rows like a republish", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({ id: "p1", status: "published", customer_shipping_cop: null }),
    ];

    // published + missing customer shipping -> rejected with missing list
    const bad = await updateProduct("p1", { name: "New" }, undefined, db.asClient());
    assert.ok("error" in bad);
    if ("error" in bad) {
        assert.equal(bad.error, "product is not publishable");
        assert.ok(bad.missing?.includes("customer_shipping_cop"));
    }
    assert.equal(db.tables.catalog_products[0].name, "Lamp");

    // supplying the confirmed quote fixes it
    const ok = await updateProduct(
        "p1",
        {
            name: "New",
            customer_shipping_cop: 0,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "2026-10-07T00:00:00.000Z",
        },
        undefined,
        db.asClient()
    );
    assert.deepEqual(ok, { ok: true, status: "published" });
    assert.equal(db.tables.catalog_products[0].name, "New");
    assert.equal(db.tables.catalog_products[0].customer_shipping_cop, 0);
});

test("updateProduct uses optimistic concurrency and allows draft/archived edits", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({ id: "d1", status: "draft", customer_shipping_cop: null }),
        catalogRow({ id: "a1", status: "archived", stock: 0, price_cop: 0, supplier_rights_confirmed: false }),
    ];

    // stale expectedUpdatedAt is rejected before writing
    const stale = await updateProduct("d1", { name: "X" }, "1999-01-01T00:00:00.000Z", db.asClient());
    assert.ok("error" in stale && stale.error.includes("changed"));

    // drafts and archived rows can be saved incomplete (no publishable guard)
    const okDraft = await updateProduct("d1", { name: "X" }, "2026-10-01T00:00:00.000Z", db.asClient());
    assert.deepEqual(okDraft, { ok: true, status: "draft" });
    const okArchived = await updateProduct("a1", { description: "" }, undefined, db.asClient());
    assert.deepEqual(okArchived, { ok: true, status: "archived" });

    const missing = await updateProduct("nope", { name: "X" }, undefined, db.asClient());
    assert.deepEqual(missing, { error: "product not found" });
});

test("archiveProduct hides without deleting and republish revalidates the guard", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({ id: "p1", status: "published" }),
        catalogRow({ id: "a1", status: "archived", customer_shipping_cop: null }),
    ];

    const arch = await archiveProduct("p1", undefined, db.asClient());
    assert.deepEqual(arch, { ok: true, wasPublished: true });
    assert.equal(db.tables.catalog_products.find((r) => r.id === "p1")?.status, "archived");
    assert.equal(db.tables.catalog_products.length, 2, "archive must not delete the row");

    const again = await archiveProduct("p1", undefined, db.asClient());
    assert.ok("error" in again);

    // archived international row cannot republish until the quote is confirmed
    const blocked = await publishCatalogProduct("a1", "admin-1", {}, undefined, db.asClient());
    assert.ok("error" in blocked);
    if ("error" in blocked) assert.ok(blocked.missing?.includes("customer_shipping_cop"));

    const repub = await publishCatalogProduct(
        "a1",
        "admin-1",
        {
            customer_shipping_cop: 0,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "2026-10-07T12:00:00.000Z",
        },
        undefined,
        db.asClient()
    );
    assert.deepEqual(repub, { ok: true });
    const row = db.tables.catalog_products.find((r) => r.id === "a1");
    assert.equal(row?.status, "published");
    assert.equal(row?.reviewed_by, "admin-1");
});

test("incomplete drafts save: category/description may be empty, name is required", () => {
    const res = sanitizeReviewFields({ category: "", description: "", name: "Lamp" });
    assert.deepEqual(res.errors, []);
    assert.equal(res.fields.category, "");
    assert.equal(res.fields.description, "");

    const noName = sanitizeReviewFields({ name: "" });
    assert.ok(noName.errors.includes("invalid field: name"));

    // publishable guard unchanged: empty strings still fail at publish time
    const base = {
        name: "Lamp",
        category: "",
        description: "",
        images: ["https://x.test/a.jpg"],
        price_cop: 100,
        stock: 1,
        supplier_rights_confirmed: true,
    };
    const v = validatePublishable(base);
    assert.ok(v.missing.includes("category"));
    assert.ok(v.missing.includes("description"));
});

test("published edits allow stock 0 (sold out) but first publish does not", async () => {
    const draftBase = {
        name: "Lamp",
        category: "lamparas",
        description: "d",
        images: ["https://x.test/a.jpg"],
        price_cop: 100,
        stock: 0,
        supplier_rights_confirmed: true,
    };
    assert.ok(validatePublishable(draftBase).missing.includes("stock"));
    assert.equal(validatePublishable(draftBase, { allowSoldOut: true }).valid, true);
    assert.ok(
        validatePublishable({ ...draftBase, stock: -1 }, { allowSoldOut: true }).missing.includes("stock")
    );
    assert.ok(
        validatePublishable({ ...draftBase, stock: 1.5 }, { allowSoldOut: true }).missing.includes("stock")
    );

    const db = new FakeDb();
    db.tables.catalog_products = [
        catalogRow({ id: "p1", status: "published", stock: 4 }),
    ];
    const soldOut = await updateProduct("p1", { stock: 0 }, undefined, db.asClient());
    assert.deepEqual(soldOut, { ok: true, status: "published" });
    assert.equal(db.tables.catalog_products[0].stock, 0);
});

test("publishCatalogProduct compares expectedUpdatedAt before writing", async () => {
    const db = new FakeDb();
    db.tables.catalog_products = [catalogRow({ id: "d1", status: "draft" })];

    const stale = await publishCatalogProduct(
        "d1",
        "admin-1",
        {},
        "1999-01-01T00:00:00.000Z",
        db.asClient()
    );
    assert.ok("error" in stale && stale.error.includes("changed"));
    assert.equal(db.tables.catalog_products[0].status, "draft");

    const ok = await publishCatalogProduct(
        "d1",
        "admin-1",
        {},
        "2026-10-01T00:00:00.000Z",
        db.asClient()
    );
    assert.deepEqual(ok, { ok: true });
    assert.equal(db.tables.catalog_products[0].status, "published");
});
