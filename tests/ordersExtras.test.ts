import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    createPendingOrder,
    listApprovedReviewsForProduct,
    listReviewsForAdmin,
    lookupForGuest,
    moderateReview,
    submitOrderReview,
    updateOrderAdmin,
} from "../lib/orders/repository.ts";
import {
    awardPointsForOrder,
    getLoyaltyBalance,
    pointsForSubtotal,
    redeemPointsForOrder,
    restorePointsForOrder,
    POINT_VALUE_COP,
} from "../lib/loyalty/service.ts";
import { placeSupplierOrder } from "../lib/suppliers/fulfillment.ts";
import type { OrderCustomer, OrderPricing, OrderRow } from "../lib/orders/types.ts";

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

function newDb(): FakeDb {
    const db = new FakeDb();
    db.unique["loyalty_transactions"] = [["order_id", "kind"]];
    db.unique["product_reviews"] = [["order_id", "product_id"]];
    db.unique["loyalty_accounts"] = [["user_id"]];
    return db;
}

async function seedOrder(db: FakeDb, overrides: Partial<OrderRow> = {}): Promise<OrderRow> {
    const created = await createPendingOrder(
        CUSTOMER,
        pricingFor(),
        "2026-10-07T00:00:00Z",
        null,
        db.asClient()
    );
    assert.ok("ok" in created);
    const row = db.table("orders")[0] as unknown as OrderRow;
    Object.assign(row, overrides);
    return row;
}

// ---------- reviews ----------

test("review requires a delivered order and matching order credentials", async () => {
    const db = newDb();
    const order = await seedOrder(db, { fulfillment_status: "payment_confirmed" });

    const notDelivered = await submitOrderReview(
        { ref: order.ref, contact: "3001234567", productId: "p-1", rating: 5, comment: "Buena" },
        db.asClient()
    );
    assert.ok("error" in notDelivered && notDelivered.error === "only delivered orders can be reviewed");

    (db.table("orders")[0] as unknown as OrderRow).fulfillment_status = "delivered";

    const badContact = await submitOrderReview(
        { ref: order.ref, contact: "3019999999", productId: "p-1", rating: 5, comment: "Buena" },
        db.asClient()
    );
    assert.ok("error" in badContact && badContact.error === "order not found");

    const badProduct = await submitOrderReview(
        { ref: order.ref, contact: "3001234567", productId: "nope", rating: 5, comment: "Buena" },
        db.asClient()
    );
    assert.ok("error" in badProduct && badProduct.error === "product not in this order");

    const ok = await submitOrderReview(
        { ref: order.ref, contact: "3001234567", productId: "p-1", rating: 5, comment: "Llegó bien" },
        db.asClient()
    );
    assert.ok("ok" in ok);
    assert.equal(db.table("product_reviews").length, 1);
    assert.equal(db.table("product_reviews")[0].status, "pending");

    const dupe = await submitOrderReview(
        { ref: order.ref, contact: "3001234567", productId: "p-1", rating: 4, comment: "Otra" },
        db.asClient()
    );
    assert.ok("error" in dupe && dupe.error === "already reviewed");

    // the order now reports the product as reviewed in public shape
    const pub = await lookupForGuest(order.ref, "3001234567", db.asClient());
    assert.ok(pub);
    assert.deepEqual(pub.reviewedProductIds, ["p-1"]);
});

test("review token path works and moderation gates public visibility", async () => {
    const db = newDb();
    const order = await seedOrder(db, { fulfillment_status: "delivered" });

    const ok = await submitOrderReview(
        { ref: order.ref, token: order.lookup_token, productId: "p-1", rating: 4, comment: "Cumple" },
        db.asClient()
    );
    assert.ok("ok" in ok);

    // approved list is empty until moderated
    assert.equal((await listApprovedReviewsForProduct("p-1", db.asClient())).length, 0);

    const review = db.table("product_reviews")[0];
    review.id = "rev-1"; // FakeDb doesn't apply gen_random_uuid() defaults
    const mod = await moderateReview(String(review.id), "approved", db.asClient());
    assert.ok("ok" in mod);

    const approved = await listApprovedReviewsForProduct("p-1", db.asClient());
    assert.equal(approved.length, 1);
    assert.equal(approved[0].reviewerName, "Ana***");
    assert.equal(approved[0].rating, 4);

    // re-moderation is rejected — state change is one-way from pending
    assert.ok("error" in (await moderateReview(String(review.id), "rejected", db.asClient())));

    const adminList = await listReviewsForAdmin("approved", db.asClient());
    assert.ok("reviews" in adminList && adminList.reviews.length === 1);
    assert.equal(adminList.reviews[0].order_ref, order.ref);
});

// ---------- loyalty ----------

test("award credits the account by email match and is idempotent", async () => {
    const db = newDb();
    db.table("profiles").push({ id: "u-1", email: "ana@test.co" });
    const order = await seedOrder(db, { payment_status: "paid" });

    const first = await awardPointsForOrder(order, db.asClient());
    assert.ok("ok" in first && first.awarded === 50); // 50000 / 1000 * 1.0
    const account = db.table("loyalty_accounts")[0];
    assert.equal(account.points, 50);
    assert.equal(account.lifetime_points, 50);

    const second = await awardPointsForOrder(order, db.asClient());
    assert.ok("ok" in second && second.awarded === 0);
    assert.equal(db.table("loyalty_accounts")[0].points, 50);

    // orders without a matching account earn nothing but don't fail
    const guest = await seedOrder(newDb());
    const noUser = await awardPointsForOrder(guest, (db2 => db2)(newDb()).asClient());
    assert.ok("ok" in noUser);
});

test("pointsForSubtotal respects tier multiplier", () => {
    assert.equal(pointsForSubtotal(50000, 0), 50);
    assert.equal(pointsForSubtotal(50000, 1600), 75); // oro 1.5x
    assert.equal(pointsForSubtotal(999, 0), 0);
});

test("redemption debits once, applies discount, and restores on cancel", async () => {
    const db = newDb();
    db.table("loyalty_accounts").push({ user_id: "u-1", points: 100, lifetime_points: 200 });

    const created = await createPendingOrder(
        CUSTOMER,
        pricingFor(),
        "2026-10-07T00:00:00Z",
        { userId: "u-1", points: 40 },
        db.asClient()
    );
    assert.ok("ok" in created);
    const order = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(order.discount_cop, 40 * POINT_VALUE_COP);
    assert.equal(order.total_cop, 65000 - 400);
    assert.equal(db.table("loyalty_accounts")[0].points, 60);

    const cancelled = await updateOrderAdmin(order.id, { action: "cancel" }, db.asClient());
    assert.ok("ok" in cancelled);
    assert.equal(db.table("loyalty_accounts")[0].points, 100);

    // restore is idempotent
    const again = await restorePointsForOrder(order.id, db.asClient());
    assert.ok("ok" in again && again.restored === 0);
});

test("insufficient points cancel the pending order and keep the balance", async () => {
    const db = newDb();
    db.table("loyalty_accounts").push({ user_id: "u-1", points: 10, lifetime_points: 0 });

    const res = await createPendingOrder(
        CUSTOMER,
        pricingFor(),
        "2026-10-07T00:00:00Z",
        { userId: "u-1", points: 50 },
        db.asClient()
    );
    assert.ok("error" in res);
    const order = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(order.payment_status, "cancelled");
    assert.equal(db.table("loyalty_accounts")[0].points, 10);
});

test("redeemPointsForOrder rejects overspend and double redemption", async () => {
    const db = newDb();
    db.table("loyalty_accounts").push({ user_id: "u-1", points: 30, lifetime_points: 30 });

    assert.ok("error" in (await redeemPointsForOrder("u-1", "o-1", 31, db.asClient())));
    const ok = await redeemPointsForOrder("u-1", "o-1", 20, db.asClient());
    assert.ok("ok" in ok);
    assert.equal(db.table("loyalty_accounts")[0].points, 10);
    // same order can't redeem twice
    assert.ok("error" in (await redeemPointsForOrder("u-1", "o-1", 5, db.asClient())));
    // balance restored after the duplicate attempt
    assert.equal(db.table("loyalty_accounts")[0].points, 10);

    const balance = await getLoyaltyBalance("u-1", db.asClient());
    assert.ok("points" in balance && balance.points === 10 && balance.tier === "bronce");
});

// ---------- supplier fulfillment guards ----------

test("supplier placement requires a verified paid order", async () => {
    const db = newDb();
    const pending = await seedOrder(db, {});
    const blocked = await placeSupplierOrder(pending.id, db.asClient());
    assert.ok("error" in blocked && blocked.error.includes("paid"));

    const paidNoSupplier = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
    });
    const noItems = await placeSupplierOrder(paidNoSupplier.id, db.asClient());
    assert.ok("error" in noItems && noItems.error.includes("no supplier-backed"));
});

test("supplier placement rejects DS items without a variant snapshot", async () => {
    const db = newDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
    });
    (db.table("order_items")[0] as { source: string }).source = "aliexpress_ds";
    (db.table("order_items")[0] as { supplier_variant: unknown }).supplier_variant = null;

    const res = await placeSupplierOrder(order.id, db.asClient());
    assert.ok("error" in res && res.error.includes("snapshot"));
});

test("supplier placement records provider failure honestly", async () => {
    const db = newDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
    });
    const item = db.table("order_items")[0] as { source: string; supplier_variant: unknown };
    item.source = "aliexpress_ds";
    item.supplier_variant = { product_id: "123", sku_id: "sku-1", sku_attr: "attr" };

    // no DS credentials configured → provider error, never a fake success
    const res = await placeSupplierOrder(order.id, db.asClient());
    assert.ok("error" in res);
    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.supplier_order_status, "failed");
    assert.ok(typeof row.supplier_order_error === "string" && row.supplier_order_error.length > 0);
    assert.ok(db.table("order_events").some((e) => e.label === "Pedido a proveedor falló"));

    // a submitted order never re-places
    row.supplier_order_status = "submitted";
    row.supplier_order_id = "aliexpress_ds:abc";
    const again = await placeSupplierOrder(order.id, db.asClient());
    assert.ok("ok" in again && again.alreadyPlaced);
    assert.equal(again.supplierOrderId, "aliexpress_ds:abc");
});
