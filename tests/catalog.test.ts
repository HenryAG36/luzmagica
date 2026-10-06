import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildDraftId,
    buildDraftInsert,
    estimateMarginCOP,
    isValidProviderItemId,
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
    };
    const product = toPublicProduct(row) as unknown as Record<string, unknown>;
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
