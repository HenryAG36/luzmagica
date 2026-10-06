import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCartTotals } from "../lib/cart/totals.ts";
import type { CartItem, Product } from "../lib/types.ts";

function product(partial: Partial<Product>): Product {
    return {
        id: "p1",
        name: "Item",
        price: 0,
        originalPrice: null,
        category: "cat",
        room: "",
        images: [],
        badge: null,
        description: "d",
        stock: 5,
        type: "",
        ...partial,
    };
}

function item(partial: Partial<Product>, quantity = 1): CartItem {
    return { product: product(partial), quantity };
}

test("legacy cart keeps free-shipping threshold and flat fee", () => {
    const t1 = computeCartTotals([item({ id: "a", price: 50000 })], null, 0);
    assert.equal(t1.shippingCop, 15000);
    assert.equal(t1.total, 65000);

    const t2 = computeCartTotals([item({ id: "a", price: 150000 })], null, 0);
    assert.equal(t2.shippingCop, 0);
    assert.equal(t2.total, 150000);
});

test("ds items charge per-unit estimate and exclude free threshold", () => {
    const ds = item(
        {
            id: "ds1",
            price: 24412,
            shippingQuoteRequired: true,
            shippingEstimateCOP: 5000,
        },
        2
    );
    const t = computeCartTotals([ds], null, 0);
    assert.equal(t.legacyShippingCop, 0);
    assert.equal(t.dsShippingCop, 10000);
    assert.equal(t.shippingCop, 10000);
    assert.equal(t.total, 24412 * 2 + 10000);
    assert.equal(t.dsPending, false);
});

test("mixed cart computes legacy shipping on legacy subtotal plus ds fees", () => {
    const items = [
        item({ id: "a", price: 149999 }),
        item({
            id: "ds1",
            price: 24412,
            shippingQuoteRequired: true,
            shippingEstimateCOP: 5000,
        }),
    ];
    const t = computeCartTotals(items, null, 0);
    assert.equal(t.legacySubtotal, 149999);
    assert.equal(t.legacyShippingCop, 15000);
    assert.equal(t.dsShippingCop, 5000);
    assert.equal(t.shippingCop, 20000);
    assert.equal(t.total, 149999 + 24412 + 20000);
});

test("ds items do not count toward the legacy free-shipping threshold", () => {
    const items = [
        item({ id: "a", price: 10000 }),
        item({
            id: "ds1",
            price: 500000,
            shippingQuoteRequired: true,
            shippingEstimateCOP: 0,
        }),
    ];
    const t = computeCartTotals(items, null, 0);
    assert.equal(t.legacyShippingCop, 15000);
    assert.equal(t.total, 10000 + 500000 + 15000);
});

test("enviogratis coupon waives only legacy shipping, not ds fees", () => {
    const items = [
        item({ id: "a", price: 50000 }),
        item({
            id: "ds1",
            price: 24412,
            shippingQuoteRequired: true,
            shippingEstimateCOP: 5000,
        }),
    ];
    const t = computeCartTotals(items, "ENVIOGRATIS", 0);
    assert.equal(t.legacyShippingCop, 0);
    assert.equal(t.dsShippingCop, 5000);
    assert.equal(t.shippingCop, 5000);
    assert.equal(t.total, 50000 + 24412 + 5000);
});

test("coupon discount applies to product subtotal only, not shipping", () => {
    const items = [item({ id: "a", price: 100000 })];
    const t = computeCartTotals(items, "MAGIA10", 10);
    assert.equal(t.discountCop, 10000);
    assert.equal(t.shippingCop, 15000);
    assert.equal(t.total, 100000 - 10000 + 15000);
});

test("ds item without an estimate makes shipping and total pending", () => {
    const items = [
        item({ id: "a", price: 50000 }),
        item({ id: "ds1", price: 24412, shippingQuoteRequired: true, shippingEstimateCOP: null }),
    ];
    const t = computeCartTotals(items, null, 0);
    assert.equal(t.dsPending, true);
    assert.equal(t.shippingCop, null);
    assert.equal(t.total, null);
    assert.equal(t.legacyShippingCop, 15000);
});

test("ds item missing estimate field is pending too", () => {
    const t = computeCartTotals(
        [item({ id: "ds1", price: 100, shippingQuoteRequired: true })],
        null,
        0
    );
    assert.equal(t.dsPending, true);
    assert.equal(t.total, null);
});

test("invalid ds shipping estimates are pending, never zeroed", () => {
    const cases = [Number.NaN, -5, Number.POSITIVE_INFINITY];
    for (const bad of cases) {
        const t = computeCartTotals(
            [item({ id: "ds1", price: 100, shippingQuoteRequired: true, shippingEstimateCOP: bad })],
            null,
            0
        );
        assert.equal(t.dsPending, true, `expected pending for ${bad}`);
        assert.equal(t.total, null);
    }
});

test("persisted ds imports are inferred from the imp-aliexpress_ds- prefix", () => {
    const t = computeCartTotals(
        [item({ id: "imp-aliexpress_ds-1005001234567890-s1", price: 10000 })],
        "ENVIOGRATIS",
        0
    );
    assert.equal(t.dsItemCount, 1);
    assert.equal(t.dsPending, true);
    assert.equal(t.legacyShippingCop, 0);
    assert.equal(t.total, null);
});

test("cj dropshipping items are quote-required and never get legacy shipping", () => {
    const cjPending = item({ id: "imp-cjdropshipping-abc-123", price: 30000 });
    const t = computeCartTotals([cjPending], null, 0);
    assert.equal(t.dsPending, true);
    assert.equal(t.dsShippingCop, null);
    assert.equal(t.shippingCop, null);
    assert.equal(t.total, null);
    assert.equal(t.legacyShippingCop, 0);

    const cjQuoted = item({
        id: "imp-cjdropshipping-abc-123",
        price: 30000,
        shippingQuoteRequired: true,
        shippingEstimateCOP: 8000,
    });
    const t2 = computeCartTotals([cjQuoted], "ENVIOGRATIS", 10);
    assert.equal(t2.dsPending, false);
    assert.equal(t2.dsShippingCop, 8000);
    assert.equal(t2.shippingCop, 8000);
    assert.equal(t2.total, 30000 - 3000 + 8000);
    assert.equal(t2.legacyShippingCop, 0);
});
