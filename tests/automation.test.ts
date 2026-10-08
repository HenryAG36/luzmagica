import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    applyWompiEvent,
    createPendingOrder,
    getAttentionQueue,
    lookupForGuest,
    type WompiEventInput,
} from "../lib/orders/repository.ts";
import { submitCustomerClaim, listClaimsForAdmin } from "../lib/orders/claims.ts";
import { retryQueuedSupplierOrders } from "../lib/suppliers/fulfillment.ts";
import { syncOrderTracking, parseSupplierRefs } from "../lib/suppliers/tracking.ts";
import { pickCjDisputeReasonId } from "../lib/suppliers/disputes.ts";
import {
    normalizeCjDisputeConfirm,
    normalizeCjDisputeProducts,
    normalizeCjOrderDetail,
    normalizeCjTrackInfo,
    normalizeCjUploadFile,
} from "../lib/suppliers/cjdropshipping.ts";
import { normalizeDsOrderDetail } from "../lib/suppliers/aliexpressDs.ts";
import type { OrderCustomer, OrderItemRow, OrderPricing, OrderRow } from "../lib/orders/types.ts";

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
    db.unique["supplier_claims"] = [["order_item_id", "reason"]];
    db.unique["loyalty_transactions"] = [["order_id", "kind"]];
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
    const row = db.table("orders")[db.table("orders").length - 1] as unknown as OrderRow;
    Object.assign(row, overrides);
    return row;
}

function wompiEvent(order: OrderRow, status = "APPROVED"): WompiEventInput {
    return {
        transactionId: `tx-${order.ref}`,
        status,
        amountInCents: order.total_cop * 100,
        paymentLinkId: order.payment_link_id ?? "link-1",
        checksum: "sig",
        payload: null,
    };
}

// ---------- auto-fulfillment trigger ----------

test("paid webhook queues supplier placement only for supplier-backed items", async () => {
    const db = newDb();
    const manual = await seedOrder(db, { payment_link_id: "link-1" });
    const manualItems = db.table("order_items").filter((i) => i.order_id === manual.id);
    for (const i of manualItems) i.source = "manual";

    const res = await applyWompiEvent(wompiEvent(manual), db.asClient());
    assert.ok("ok" in res && res.outcome === "paid");
    assert.equal((db.table("orders")[0] as { supplier_order_status: unknown }).supplier_order_status ?? null, null);

    // supplier-backed item → queued
    const db2 = newDb();
    const order = await seedOrder(db2, { payment_link_id: "link-2" });
    const item = db2.table("order_items")[0] as unknown as OrderItemRow;
    item.source = "aliexpress_ds";
    item.supplier_variant = { product_id: "123", sku_id: "s1", sku_attr: "a" };

    const res2 = await applyWompiEvent(wompiEvent(order), db2.asClient());
    assert.ok("ok" in res2 && res2.outcome === "paid");
    assert.equal((db2.table("orders")[0] as { supplier_order_status: unknown }).supplier_order_status, "queued");
});

test("retry cron picks up queued orders and caps attempts", async () => {
    const db = newDb();
    await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
        supplier_order_status: "queued",
    });
    const item = db.table("order_items")[0] as unknown as OrderItemRow;
    item.source = "aliexpress_ds";
    item.supplier_variant = { product_id: "123", sku_id: "s1", sku_attr: "a" };

    // No DS credentials → placement fails honestly, attempt counted
    const res = await retryQueuedSupplierOrders(db.asClient());
    assert.ok("attempted" in res && res.attempted === 1 && res.failed === 1);
    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.supplier_order_status, "failed");
    assert.equal(row.auto_fulfill_attempts, 1);

    // After the cap, the order is left for the attention queue
    row.auto_fulfill_attempts = 3;
    const res2 = await retryQueuedSupplierOrders(db.asClient());
    assert.ok("attempted" in res2 && res2.attempted === 0);
});

// ---------- supplier ref parsing ----------

test("parseSupplierRefs handles combined refs", () => {
    assert.deepEqual(parseSupplierRefs("aliexpress_ds:801,cjdropshipping:CJ9"), {
        ds: "801",
        cj: "CJ9",
    });
    assert.deepEqual(parseSupplierRefs(null), { ds: null, cj: null });
    assert.deepEqual(parseSupplierRefs("cjdropshipping:CJ9"), { ds: null, cj: "CJ9" });
});

// ---------- CJ normalizers ----------

test("CJ order detail and track info normalize", () => {
    const detail = normalizeCjOrderDetail({
        code: 200,
        result: true,
        data: {
            orderId: "CJ123",
            orderNum: "LM-1",
            orderStatus: "DISPATCHED",
            logisticName: "CJPacket",
            trackNumber: "TRK9",
            trackingUrl: "https://track.cj/TRK9",
        },
    });
    assert.equal(detail?.trackNumber, "TRK9");
    assert.equal(detail?.orderStatus, "DISPATCHED");

    const track = normalizeCjTrackInfo({
        code: 200,
        result: true,
        data: [
            {
                trackingNumber: "TRK9",
                logisticName: "CJPacket",
                trackingStatus: "In transit",
                lastMileCarrier: "Servientrega",
                lastTrackNumber: "LM456",
            },
        ],
    });
    assert.equal(track?.[0].lastTrackNumber, "LM456");
    assert.equal(track?.[0].lastMileCarrier, "Servientrega");
    assert.equal(normalizeCjTrackInfo({ code: 1600100, result: false, data: null }), null);
});

test("CJ dispute normalizers parse products, confirm info, upload", () => {
    const products = normalizeCjDisputeProducts({
        code: 200,
        result: true,
        data: {
            orderId: "CJ1",
            productInfoList: [
                { lineItemId: "li-1", cjProductId: "pid-9", canChoose: true, price: 23, quantity: 1, cjProductName: "Lamp" },
                { lineItemId: "li-2", cjProductId: "pid-8", canChoose: false, price: 5, quantity: 1 },
            ],
        },
    });
    assert.equal(products?.length, 2);
    assert.equal(products?.[0].canChoose, true);
    assert.equal(products?.[1].canChoose, false);

    const confirm = normalizeCjDisputeConfirm({
        code: 200,
        result: true,
        data: {
            maxAmount: 23.0,
            disputeReasonList: [
                { disputeReasonId: 1, reasonName: "Item not received" },
                { disputeReasonId: 7, reasonName: "Quality issue" },
            ],
        },
    });
    assert.equal(confirm?.reasons.length, 2);

    const upload = normalizeCjUploadFile({
        code: 200,
        result: true,
        data: { url: "https://oss.cjdropshipping.com/x.jpg", fileType: "IMAGE", size: 100 },
    });
    assert.equal(upload?.url, "https://oss.cjdropshipping.com/x.jpg");
});

test("pickCjDisputeReasonId maps claim reasons to provider reason ids", () => {
    const reasons = [
        { disputeReasonId: 1, reasonName: "Item not received" },
        { disputeReasonId: 7, reasonName: "Quality issue" },
        { disputeReasonId: 9, reasonName: "Wrong item shipped" },
    ];
    assert.equal(pickCjDisputeReasonId(reasons, "defective")?.disputeReasonId, 7);
    assert.equal(pickCjDisputeReasonId(reasons, "not_received")?.disputeReasonId, 1);
    assert.equal(pickCjDisputeReasonId(reasons, "wrong_item")?.disputeReasonId, 9);
    assert.equal(pickCjDisputeReasonId(reasons, "other")?.disputeReasonId, 1);
    assert.equal(pickCjDisputeReasonId(reasons, "damaged"), null);
    assert.equal(pickCjDisputeReasonId([], "other"), null);
});

// ---------- DS order detail normalizer ----------

test("DS order detail finds nested logistics fields", () => {
    const detail = normalizeDsOrderDetail({
        aliexpress_trade_ds_order_get_response: {
            rsp_code: "200",
            result: {
                order_status: "WAIT_SELLER_SEND_GOODS",
                logistics_status: "NO_LOGISTICS",
                logistics_info_list: [{ logistics_no: "AE123", logistics_service: "AliExpress Standard" }],
            },
        },
    });
    assert.equal(detail?.trackingNo, "AE123");
    assert.equal(detail?.logisticsService, "AliExpress Standard");
    assert.equal(detail?.orderStatus, "WAIT_SELLER_SEND_GOODS");
    assert.equal(normalizeDsOrderDetail({}), null);
});

// ---------- tracking sync ----------

test("syncOrderTracking imports last-mile tracking and advances transit", async () => {
    process.env.CJ_API_KEY = "test-key";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "0".repeat(64);
    const db = newDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "supplier_processing",
        supplier_order_id: "cjdropshipping:CJ123",
        supplier_order_status: "submitted",
    });

    const fakeFetch = async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        let payload: unknown;
        if (url.includes("/authentication/getAccessToken")) {
            payload = {
                code: 200,
                result: true,
                data: { accessToken: "tok", accessTokenExpiryDate: new Date(Date.now() + 3600e3).toISOString() },
            };
        } else if (url.includes("/shopping/order/getOrderDetail")) {
            payload = {
                code: 200,
                result: true,
                data: { orderId: "CJ123", orderStatus: "DISPATCHED", trackNumber: "TRK9", logisticName: "CJPacket" },
            };
        } else if (url.includes("/logistic/trackInfo")) {
            payload = {
                code: 200,
                result: true,
                data: [{ trackingNumber: "TRK9", trackingStatus: "In transit", lastMileCarrier: "Servientrega", lastTrackNumber: "LM456" }],
            };
        } else {
            payload = { code: 500, result: false };
        }
        void init;
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };

    const res = await syncOrderTracking(order.id, {}, db.asClient(), fakeFetch);
    assert.ok("ok" in res, JSON.stringify(res));
    assert.equal(res.trackingNumber, "LM456");
    assert.equal(res.carrier, "Servientrega");
    assert.ok(res.fulfillmentAdvanced);

    const row = db.table("orders")[0] as unknown as OrderRow;
    assert.equal(row.tracking_number, "LM456");
    assert.equal(row.fulfillment_status, "international_transit");
    assert.ok(row.supplier_synced_at);
    assert.ok(db.table("order_events").some((e) => e.label === "Guía registrada"));

    // Delivered is never set automatically by supplier data
    row.fulfillment_status = "local_delivery";
    const again = await syncOrderTracking(order.id, { force: true }, db.asClient(), fakeFetch);
    assert.ok("ok" in again);
    assert.equal((db.table("orders")[0] as { fulfillment_status: string }).fulfillment_status, "local_delivery");

    delete process.env.CJ_API_KEY;
    delete process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
});

// ---------- customer claims ----------

test("claim requires order credentials, claimable state, and valid files", async () => {
    const db = newDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "international_transit",
    });
    const itemId = (db.table("order_items")[0] as { id: number }).id ?? 1;
    db.table("order_items")[0].id = itemId;

    const uploads: string[] = [];
    const uploader = async (path: string) => {
        uploads.push(path);
        return { ok: true as const };
    };
    const file = { name: "foto.jpg", type: "image/jpeg", bytes: new ArrayBuffer(1024) };

    const badContact = await submitCustomerClaim(
        { ref: order.ref, contact: "999", productId: "p-1", reason: "defective", description: "Llegó roto de fábrica", files: [file] },
        db.asClient(),
        uploader
    );
    assert.ok("error" in badContact && badContact.error === "order not found");

    const badReason = await submitCustomerClaim(
        { ref: order.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "meh", description: "Llegó roto de fábrica", files: [] },
        db.asClient(),
        uploader
    );
    assert.ok("error" in badReason && badReason.error === "invalid reason");

    const badFile = await submitCustomerClaim(
        { ref: order.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "defective", description: "Llegó roto de fábrica", files: [{ name: "x.exe", type: "application/octet-stream", bytes: new ArrayBuffer(10) }] },
        db.asClient(),
        uploader
    );
    assert.ok("error" in badFile);

    const ok = await submitCustomerClaim(
        { ref: order.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "defective", description: "Llegó roto de fábrica", files: [file] },
        db.asClient(),
        uploader
    );
    assert.ok("ok" in ok, JSON.stringify(ok));
    assert.equal(uploads.length, 1);
    const claim = db.table("supplier_claims")[0];
    assert.equal(claim.provider, "manual");
    assert.equal(claim.status, "draft");
    assert.equal(claim.created_by, "customer");
    assert.equal((claim.evidence_paths as string[]).length, 1);
    assert.ok(db.table("order_events").some((e) => e.label === "Reclamo de cliente"));

    // duplicate same reason on the same item is rejected
    const dupe = await submitCustomerClaim(
        { ref: order.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "defective", description: "Sigue roto...", files: [] },
        db.asClient(),
        uploader
    );
    assert.ok("error" in dupe && dupe.error === "claim already exists");

    // the claim surfaces in the public order shape
    const pub = await lookupForGuest(order.ref, CUSTOMER.phone, db.asClient());
    assert.equal(pub?.claims.length, 1);
    assert.equal(pub?.claims[0].status, "draft");

    // unpaid orders can't claim
    const db2 = newDb();
    const pending = await seedOrder(db2, {});
    const blocked = await submitCustomerClaim(
        { ref: pending.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "defective", description: "Llegó roto de fábrica", files: [] },
        db2.asClient(),
        uploader
    );
    assert.ok("error" in blocked && blocked.error === "order is not claimable");
});

test("admin claims list joins order and product data", async () => {
    const db = newDb();
    const order = await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "delivered",
    });
    const uploader = async () => ({ ok: true as const });
    const ok = await submitCustomerClaim(
        { ref: order.ref, contact: CUSTOMER.phone, productId: "p-1", reason: "damaged", description: "Caja aplastada y vidrio roto", files: [] },
        db.asClient(),
        uploader
    );
    assert.ok("ok" in ok);
    const list = await listClaimsForAdmin("draft", db.asClient());
    assert.ok("claims" in list && list.claims.length === 1);
    assert.equal(list.claims[0].order_ref, order.ref);
    assert.equal(list.claims[0].product_name, "Lámpara Test");
    assert.equal(list.claims[0].customer_name, "Ana Prueba");
});

// ---------- attention queue ----------

test("attention queue surfaces failed placements, stale queued, and draft claims", async () => {
    const db = newDb();
    await seedOrder(db, {
        payment_status: "paid",
        fulfillment_status: "payment_confirmed",
        supplier_order_status: "failed",
    });
    db.table("supplier_claims").push({
        id: "c1",
        order_id: "x",
        order_item_id: 1,
        provider: "cjdropshipping",
        reason: "defective",
        description: "desc",
        evidence_paths: [],
        status: "draft",
        created_by: "customer",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });

    const queue = await getAttentionQueue(db.asClient());
    assert.ok("paymentReview" in queue);
    assert.equal(queue.supplierFailed, 1);
    assert.equal(queue.draftClaims, 1);
    assert.ok(queue.orders.some((o) => o.issue.includes("falló")));
});
