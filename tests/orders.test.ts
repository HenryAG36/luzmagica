import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    normalizePhone,
    sanitizeOrderInput,
    sanitizeOrderLookup,
    sanitizeOrderStatusQuery,
} from "../lib/orders/validate.ts";
import { priceOrder } from "../lib/orders/pricing.ts";
import {
    applyWompiEvent,
    canTransitionFulfillment,
    cartFingerprint,
    createPendingOrder,
    lookupForGuest,
    updateOrderAdmin,
} from "../lib/orders/repository.ts";
import type { OrderCustomer, OrderPricing, OrderRow } from "../lib/orders/types.ts";

// ---------- fixtures ----------

function catalogRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "p-1",
        name: "Lámpara Test",
        price_cop: 50000,
        original_price_cop: null,
        category: "Hogar",
        room: "sala",
        images: [],
        badge: null,
        description: "desc",
        stock: 10,
        type: "fisico",
        listing_price: null,
        listing_currency: null,
        supplier_cost_cop: 30000,
        supplier_shipping_cop: null,
        taxes_fees_cop: null,
        fx_rate: null,
        fx_rate_date: null,
        supplier_rights_confirmed: true,
        supplier_variant: { sku: "SKU-1" },
        customer_shipping_cop: null,
        shipping_estimate_city: null,
        shipping_checked_at: null,
        status: "published",
        source: "manual",
        reviewed_by: null,
        published_at: null,
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

const CUSTOMER: OrderCustomer = {
    name: "Ana Prueba",
    email: "ana@test.co",
    phone: "3001234567",
    cedula: "1020304050",
    address: "Calle 1 #2-3",
    city: "Bogotá",
    department: "Cundinamarca",
    notes: null,
};

function pricingFor(overrides: Partial<OrderPricing> = {}): OrderPricing {
    return {
        items: [
            {
                productId: "p-1",
                name: "Lámpara Test",
                unitPriceCop: 50000,
                quantity: 1,
                unitShippingCop: 0,
                unitSupplierCostCop: 30000,
                source: "manual",
                supplierVariant: { sku: "SKU-1" },
            },
        ],
        subtotalCop: 50000,
        discountCop: 0,
        shippingCop: 15000,
        totalCop: 65000,
        couponCode: null,
        ...overrides,
    };
}

async function seedOrder(db: FakeDb, overrides: Partial<OrderRow> = {}): Promise<OrderRow> {
    const created = await createPendingOrder(CUSTOMER, pricingFor(), "2026-10-07T00:00:00Z", db.asClient());
    assert.ok("ok" in created);
    const row = db.table("orders")[0] as unknown as OrderRow;
    Object.assign(row, overrides);
    return row;
}

// ---------- validation ----------

test("sanitizeOrderInput requires consent and valid customer fields", () => {
    const base = {
        customer: {
            name: "Ana",
            email: "ana@test.co",
            phone: "300 123 4567",
            cedula: "1020304050",
            address: "Calle 1 #2-3",
            city: "Bogotá",
            department: "Cundinamarca",
        },
        items: [{ productId: "p-1", quantity: 1 }],
    };
    assert.equal((sanitizeOrderInput(base) as { error?: string }).error !== undefined, true);
    const ok = sanitizeOrderInput({ ...base, consent: true });
    assert.ok(ok.ok);
    if (ok.ok) {
        assert.equal(ok.input.customer.phone, "3001234567");
        assert.equal(ok.input.customer.email, "ana@test.co");
    }
});

test("sanitizeOrderInput merges duplicate items and rejects bad quantities", () => {
    const base = {
        consent: true,
        customer: {
            name: "Ana",
            email: "ana@test.co",
            phone: "3001234567",
            cedula: "1020304050",
            address: "Calle 1 #2-3",
            city: "Bogotá",
        },
    };
    const merged = sanitizeOrderInput({
        ...base,
        items: [
            { productId: "p-1", quantity: 2 },
            { productId: "p-1", quantity: 3 },
            { productId: "p-2", quantity: 1 },
        ],
    });
    assert.ok(merged.ok);
    if (merged.ok) {
        assert.deepEqual(merged.input.items, [
            { productId: "p-1", quantity: 5 },
            { productId: "p-2", quantity: 1 },
        ]);
    }
    assert.ok(!(sanitizeOrderInput({ ...base, items: [{ productId: "p-1", quantity: 0 }] }) as { ok: boolean }).ok);
    assert.ok(!(sanitizeOrderInput({ ...base, items: [{ productId: "p-1", quantity: 21 }] }) as { ok: boolean }).ok);
    assert.ok(!(sanitizeOrderInput({ ...base, items: [{ productId: "p 1!", quantity: 1 }] }) as { ok: boolean }).ok);
});

test("lookup/status sanitizers bound inputs and normalize the ref", () => {
    assert.deepEqual(sanitizeOrderLookup({ ref: "lm-1234", contact: "3001234567" }), {
        ref: "LM-1234",
        contact: "3001234567",
    });
    assert.equal(sanitizeOrderLookup({ ref: "", contact: "x" }), null);
    const token = "a".repeat(64);
    assert.deepEqual(sanitizeOrderStatusQuery({ ref: "lm-1", token }), { ref: "LM-1", token });
    assert.equal(sanitizeOrderStatusQuery({ ref: "lm-1", token: "short" }), null);
    assert.equal(normalizePhone("+57 300-123-4567"), "573001234567");
});

// ---------- server-side pricing ----------

test("priceOrder recomputes totals from catalog rows, never client prices", async () => {
    const db = new FakeDb();
    db.table("catalog_products").push(catalogRow());
    const res = await priceOrder([{ productId: "p-1", quantity: 2 }], null, db.asClient());
    assert.ok(res.ok);
    if (res.ok) {
        assert.equal(res.pricing.subtotalCop, 100000);
        // domestic item under the free-shipping threshold pays legacy shipping
        assert.equal(res.pricing.shippingCop, 15000);
        assert.equal(res.pricing.totalCop, 115000);
        assert.equal(res.pricing.items[0].unitPriceCop, 50000);
        assert.equal(res.pricing.items[0].unitSupplierCostCop, 30000);
    }
});

test("priceOrder applies shared coupon rules and free-shipping threshold", async () => {
    const db = new FakeDb();
    db.table("catalog_products").push(catalogRow());
    const withCoupon = await priceOrder([{ productId: "p-1", quantity: 1 }], "MAGIA10", db.asClient());
    assert.ok(withCoupon.ok);
    if (withCoupon.ok) {
        assert.equal(withCoupon.pricing.discountCop, 5000);
        assert.equal(withCoupon.pricing.totalCop, 50000 - 5000 + 15000);
        assert.equal(withCoupon.pricing.couponCode, "MAGIA10");
    }
    const free = await priceOrder([{ productId: "p-1", quantity: 3 }], null, db.asClient());
    assert.ok(free.ok);
    if (free.ok) {
        assert.equal(free.pricing.shippingCop, 0);
        assert.equal(free.pricing.totalCop, 150000);
    }
    assert.ok(!(await priceOrder([{ productId: "p-1", quantity: 1 }], "NOSUCH", db.asClient())).ok);
});

test("priceOrder rejects unpublished, out-of-stock, and unshipped international items", async () => {
    const db = new FakeDb();
    db.table("catalog_products").push(
        catalogRow({ id: "arch", status: "archived" }),
        catalogRow({ id: "out", stock: 0 }),
        catalogRow({
            id: "intl",
            source: "aliexpress_ds",
            customer_shipping_cop: null,
        }),
        catalogRow({
            id: "intl-ok",
            source: "aliexpress_ds",
            customer_shipping_cop: 42000,
            shipping_estimate_city: "Bogotá",
            shipping_checked_at: "2026-10-06T00:00:00Z",
        }),
    );
    assert.ok(!(await priceOrder([{ productId: "arch", quantity: 1 }], null, db.asClient())).ok);
    assert.ok(!(await priceOrder([{ productId: "out", quantity: 1 }], null, db.asClient())).ok);
    assert.ok(!(await priceOrder([{ productId: "intl", quantity: 1 }], null, db.asClient())).ok);
    const ok = await priceOrder([{ productId: "intl-ok", quantity: 2 }], null, db.asClient());
    assert.ok(ok.ok);
    if (ok.ok) {
        assert.equal(ok.pricing.items[0].unitShippingCop, 42000);
        assert.equal(ok.pricing.shippingCop, 84000);
    }
});

// ---------- order creation + dedupe ----------

test("createPendingOrder persists order, items, and creation event; dedupes retries", async () => {
    const db = new FakeDb();
    const first = await createPendingOrder(CUSTOMER, pricingFor(), "2026-10-07T00:00:00Z", db.asClient());
    assert.ok("ok" in first && first.ok);
    if ("ok" in first) {
        assert.match(first.order.ref, /^LM-\d{6}$/);
        assert.equal(first.order.lookup_token.length, 64);
        assert.equal(first.reused, false);
    }
    assert.equal(db.table("orders").length, 1);
    assert.equal(db.table("order_items").length, 1);
    assert.equal(db.table("order_events").length, 1);
    const item = db.table("order_items")[0];
    assert.equal(item.unit_supplier_cost_cop, 30000);
    assert.equal(item.unit_price_cop, 50000);

    const second = await createPendingOrder(CUSTOMER, pricingFor(), "2026-10-07T00:01:00Z", db.asClient());
    assert.ok("ok" in second && second.reused);
    assert.equal(db.table("orders").length, 1);
});

test("cartFingerprint is order-insensitive and quantity-sensitive", () => {
    const a = cartFingerprint([
        { productId: "b", quantity: 1 },
        { productId: "a", quantity: 2 },
    ]);
    const b = cartFingerprint([
        { productId: "a", quantity: 2 },
        { productId: "b", quantity: 1 },
    ]);
    const c = cartFingerprint([{ productId: "a", quantity: 3 }]);
    assert.equal(a, b);
    assert.notEqual(a, c);
});

// ---------- wompi webhook application ----------

test("APPROVED with matching amount marks paid and decrements stock exactly once", async () => {
    const db = new FakeDb();
    db.table("catalog_products").push(catalogRow());
    const order = await seedOrder(db, { payment_link_id: "pl_1" });

    const event = {
        transactionId: "tx-1",
        status: "APPROVED",
        amountInCents: order.total_cop * 100,
        paymentLinkId: "pl_1",
        checksum: "chk",
        payload: { note: "test" },
    };
    const res = await applyWompiEvent(event, db.asClient());
    assert.ok("ok" in res);
    if ("ok" in res) {
        assert.equal(res.outcome, "paid");
        assert.ok(res.paidOrder);
    }
    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.payment_status, "paid");
    assert.equal(row.fulfillment_status, "payment_confirmed");
    assert.equal(row.wompi_transaction_id, "tx-1");
    assert.ok(row.paid_at);
    assert.equal((db.table("catalog_products")[0] as { stock: number }).stock, 9);

    // retried delivery is a duplicate — state untouched, no double decrement
    const again = await applyWompiEvent(event, db.asClient());
    assert.ok("ok" in again && again.outcome === "duplicate");
    assert.equal((db.table("catalog_products")[0] as { stock: number }).stock, 9);
});

test("APPROVED with wrong amount goes to payment_review, never fulfilled", async () => {
    const db = new FakeDb();
    const order = await seedOrder(db, { payment_link_id: "pl_1" });
    const res = await applyWompiEvent(
        {
            transactionId: "tx-2",
            status: "APPROVED",
            amountInCents: order.total_cop * 100 - 100,
            paymentLinkId: "pl_1",
            checksum: "chk",
            payload: null,
        },
        db.asClient(),
    );
    assert.ok("ok" in res && res.outcome === "amount_mismatch");
    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.payment_status, "payment_review");
    assert.equal(row.fulfillment_status, "awaiting_payment");
});

test("DECLINED/VOIDED/ERROR mark payment_failed; unknown links are recorded", async () => {
    const db = new FakeDb();
    await seedOrder(db, { payment_link_id: "pl_1" });
    const res = await applyWompiEvent(
        { transactionId: "tx-3", status: "DECLINED", amountInCents: 100, paymentLinkId: "pl_1", checksum: "c", payload: null },
        db.asClient(),
    );
    assert.ok("ok" in res && res.outcome === "failed");
    assert.equal((db.table("orders")[0] as unknown as OrderRow).payment_status, "payment_failed");

    const unmatched = await applyWompiEvent(
        { transactionId: "tx-4", status: "APPROVED", amountInCents: 1, paymentLinkId: "pl_other", checksum: "c", payload: null },
        db.asClient(),
    );
    assert.ok("ok" in unmatched && unmatched.outcome === "unmatched");
    assert.equal(db.table("payment_events").length, 2);
});

test("a terminal order ignores further payment events", async () => {
    const db = new FakeDb();
    await seedOrder(db, { payment_link_id: "pl_1", payment_status: "paid" });
    const res = await applyWompiEvent(
        { transactionId: "tx-5", status: "APPROVED", amountInCents: 6500000, paymentLinkId: "pl_1", checksum: "c", payload: null },
        db.asClient(),
    );
    assert.ok("ok" in res && res.outcome === "ignored_terminal");
    assert.equal((db.table("orders")[0] as unknown as OrderRow).payment_status, "paid");
});

// ---------- guest lookup ----------

test("guest lookup returns safe fields for matching ref+contact only", async () => {
    const db = new FakeDb();
    const order = await seedOrder(db, { payment_link_id: "pl_1" });

    const byPhone = await lookupForGuest(order.ref, "+57 300 123 4567", db.asClient());
    assert.ok(byPhone);
    assert.equal(byPhone.ref, order.ref);
    assert.equal(byPhone.totalCop, 65000);
    // no private fields leak into the public shape
    const item = byPhone.items[0] as unknown as Record<string, unknown>;
    assert.ok(!("unitSupplierCostCop" in item));
    assert.ok(!("supplierVariant" in item));
    assert.ok(!("lookup_token" in (byPhone as unknown as Record<string, unknown>)));

    const byEmail = await lookupForGuest(order.ref, "ANA@test.co", db.asClient());
    assert.ok(byEmail);
    assert.equal(await lookupForGuest(order.ref, "3019999999", db.asClient()), null);
    assert.equal(await lookupForGuest("LM-000000", "3001234567", db.asClient()), null);
});

// ---------- admin updates ----------

test("fulfillment transitions move forward only; cancelled is terminal-aware", () => {
    assert.equal(canTransitionFulfillment("payment_confirmed", "supplier_processing"), true);
    assert.equal(canTransitionFulfillment("supplier_processing", "payment_confirmed"), false);
    assert.equal(canTransitionFulfillment("delivered", "delivered"), false);
    assert.equal(canTransitionFulfillment("local_delivery", "cancelled"), true);
    assert.equal(canTransitionFulfillment("delivered", "cancelled"), false);
    assert.equal(canTransitionFulfillment("cancelled", "supplier_processing"), false);
});

test("admin update preserves omitted fields and logs events", async () => {
    const db = new FakeDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
        tracking_number: "GUIA-1",
        carrier: "Coordinadora",
    });

    // status-only update must NOT wipe the tracking number
    const res = await updateOrderAdmin(order.id, { fulfillmentStatus: "supplier_processing" }, db.asClient());
    assert.ok("ok" in res);
    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.fulfillment_status, "supplier_processing");
    assert.equal(row.tracking_number, "GUIA-1");

    // tracking-only update keeps the status
    const res2 = await updateOrderAdmin(order.id, { trackingNumber: "GUIA-2", carrier: "Servientrega" }, db.asClient());
    assert.ok("ok" in res2);
    const row2 = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row2.fulfillment_status, "supplier_processing");
    assert.equal(row2.tracking_number, "GUIA-2");
    assert.ok(db.table("order_events").some((e) => e.label === "Guía registrada"));
});

test("admin update rejects stale edits, invalid transitions, and review-blocked orders", async () => {
    const db = new FakeDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
    });

    const stale = await updateOrderAdmin(
        order.id,
        { fulfillmentStatus: "supplier_processing", expectedUpdatedAt: "1999-01-01T00:00:00Z" },
        db.asClient(),
    );
    assert.ok("error" in stale);

    const backwards = await updateOrderAdmin(order.id, { fulfillmentStatus: "awaiting_payment" }, db.asClient());
    assert.ok("error" in backwards);

    (db.table("orders")[0] as unknown as OrderRow).payment_status = "payment_review";
    const blocked = await updateOrderAdmin(order.id, { fulfillmentStatus: "supplier_processing" }, db.asClient());
    assert.ok("error" in blocked && blocked.error.includes("review"));
});

test("cancel only applies to unpaid orders; refund only to paid ones", async () => {
    const db = new FakeDb();
    const pending = await seedOrder(db, {});
    const cancelled = await updateOrderAdmin(pending.id, { action: "cancel" }, db.asClient());
    assert.ok("ok" in cancelled);
    assert.equal((db.table("orders")[0] as unknown as OrderRow).payment_status, "cancelled");

    const db2 = new FakeDb();
    const paid = await seedOrder(db2, { payment_status: "paid", fulfillment_status: "payment_confirmed" });
    assert.ok("error" in (await updateOrderAdmin(paid.id, { action: "cancel" }, db2.asClient())));
    const refunded = await updateOrderAdmin(paid.id, { action: "refund" }, db2.asClient());
    assert.ok("ok" in refunded);
    const row = db2.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.payment_status, "refunded");
    assert.equal(row.fulfillment_status, "cancelled");
});
