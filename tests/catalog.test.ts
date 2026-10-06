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
import type { PublicProductRow } from "../lib/catalog/validate.ts";

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
