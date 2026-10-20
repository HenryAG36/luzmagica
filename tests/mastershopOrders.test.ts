import { test } from "node:test";
import assert from "node:assert/strict";
import type { FetchLike } from "../lib/trends/http.ts";
import { FakeDb } from "./fakeSupabase.ts";
import type { OrderItemRow, OrderRow } from "../lib/orders/types.ts";
import {
    buildMastershopCodPayload,
    lookupMastershopOrder,
    mapMastershopRemoteStatus,
    placeMastershopCodOrder,
    syncMastershopTracking,
    validateMastershopCodItems,
    validateMastershopCodCustomer,
} from "../lib/suppliers/mastershopOrders.ts";
import { updateOrderAdmin } from "../lib/orders/repository.ts";
import { createCodOrder, codRequestFingerprint, findExistingCodOrder } from "../lib/orders/cod.ts";

// Order contract per the verified Postman collection: POST /api/orders with
// external id HON-<order uuid>, GET /api/orders?externalOrderId=… for lookup.

const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const EXTERNAL_ID = `HON-${ORDER_ID}`;
const NOW = "2026-10-20T12:00:00.000Z";

function codOrder(overrides: Record<string, unknown> = {}): OrderRow {
    return {
        id: ORDER_ID,
        ref: "LM-100001",
        lookup_token: "t".repeat(64),
        cart_fingerprint: "fp",
        customer_name: "María Pérez",
        customer_email: "maria@example.com",
        customer_phone: "3104567890",
        customer_cedula: "1234567890",
        address: "Calle 127 #15-32 Apto 402",
        city: "Bogotá",
        department: "Cundinamarca",
        notes: null,
        subtotal_cop: 89900,
        discount_cop: 0,
        shipping_cop: 10000,
        total_cop: 99900,
        coupon_code: null,
        payment_status: "cod_pending",
        fulfillment_status: "awaiting_confirmation",
        payment_method: "cash_on_delivery",
        payment_link_id: null,
        payment_link_url: null,
        wompi_transaction_id: null,
        tracking_number: null,
        carrier: null,
        review: null,
        consent_at: NOW,
        paid_at: null,
        created_at: NOW,
        updated_at: NOW,
        supplier_order_id: null,
        supplier_order_status: "queued",
        supplier_order_error: null,
        auto_fulfill_attempts: 0,
        mastershop_status: null,
        ...overrides,
    } as unknown as OrderRow;
}

function codItem(overrides: Record<string, unknown> = {}): OrderItemRow {
    return {
        id: 1,
        order_id: ORDER_ID,
        product_id: "ms-88597",
        name: "Audífonos inalámbricos",
        unit_price_cop: 89900,
        quantity: 1,
        unit_shipping_cop: 10000,
        unit_supplier_cost_cop: 52500,
        source: "mastershop",
        supplier_variant: {
            product_id: "88597",
            variation_id: "195338",
            sku: "SKU-1",
            mastershop_weight: 0.4,
        },
        ...overrides,
    } as unknown as OrderItemRow;
}

function membershipBody(idProduct = 88597): Record<string, unknown> {
    return { results: [{ idProduct, name: "x", baseCurrencyPrice: "COP" }] };
}

function detailBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        idProduct: 88597,
        nameProduct: "Audífonos inalámbricos",
        description: "x",
        baseCurrencyPrice: "COP",
        providerPrice: 89900,
        stock: 100,
        suggestedPrice: 95500,
        categoryName: "Tecno",
        urlImageProduct: "https://cdn.mastershop.com/i.jpg",
        providerName: "Prov",
        variants: [{ sku: "SKU-1", name: "Negro", price: 52500, stock: 50, idVariant: 195338 }],
        ...overrides,
    };
}

interface StubCall {
    url: string;
    method: string;
    body: string;
}

// Router: entries are [method, urlSubstring] → status/body or Response.
function stubFetch(
    routes: [string, string, number | Response, unknown?][],
    fallback: [number, unknown] = [404, { error: "nf" }]
): { fetch: FetchLike; calls: StubCall[] } {
    const calls: StubCall[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        const u = String(url);
        const method = ((init as RequestInit)?.method ?? "GET").toUpperCase();
        const body = String((init as RequestInit)?.body ?? "");
        calls.push({ url: u, method, body });
        for (const [m, pat, status, payload] of routes) {
            if (method === m && u.includes(pat)) {
                if (status instanceof Response) return status;
                if (payload instanceof Response) return payload;
                return new Response(JSON.stringify(payload), { status });
            }
        }
        return new Response(JSON.stringify(fallback[1]), { status: fallback[0] });
    };
    return { fetch: fetchImpl, calls };
}

function env() {
    process.env.MASTERSHOP_API_KEY = "ms-key-test";
    process.env.MASTERSHOP_COD_ENABLED = "true";
}
function clearEnv() {
    delete process.env.MASTERSHOP_API_KEY;
    delete process.env.MASTERSHOP_COD_ENABLED;
}

function seed(db: FakeDb, orderOverrides: Record<string, unknown> = {}, items?: OrderItemRow[]) {
    db.table("orders").push(codOrder(orderOverrides) as unknown as Record<string, unknown>);
    for (const i of items ?? [codItem()]) {
        db.table("order_items").push(i as unknown as Record<string, unknown>);
    }
}

// --- payload construction --------------------------------------------------

test("payload: exact ids, totals, cod transaction and customer fields", () => {
    const order = codOrder();
    const built = buildMastershopCodPayload(order, [codItem()]);
    assert.ok("payload" in built);
    if (!("payload" in built)) return;
    const p = built.payload as Record<string, unknown>;
    assert.equal(p.id_order, EXTERNAL_ID);
    assert.equal(p.shipping_address, p.billing_address);
    const addr = p.shipping_address as Record<string, unknown>;
    assert.equal(addr.country, "CO");
    assert.equal(addr.city, "Bogotá");
    assert.equal(addr.state, "Cundinamarca");
    assert.equal(addr.address1, "Calle 127 #15-32 Apto 402");
    assert.equal(addr.first_name, "María");
    assert.equal(addr.last_name, "Pérez");
    assert.equal(addr.phone, "3104567890");
    const tx = p.order_transaction as Record<string, unknown>;
    assert.deepEqual(tx, { total: 99900, currency: "COP", payment_method: "cod", payment_gateway: "Honesty" });
    const customer = p.customer as Record<string, unknown>;
    assert.equal(customer.documentType, "CC");
    assert.equal(customer.documentNumber, "1234567890");
    const items = p.order_items as Record<string, unknown>[];
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
        id_product: 88597,
        id_variant: 195338,
        quantity: 1,
        sku: "SKU-1",
        name: "Audífonos inalámbricos",
        weight: 0.4,
        price: 89900,
    });
    assert.deepEqual(p.additional_charge, [{ type_charge: "shipping", value: 10000 }]);
    assert.deepEqual(p.notes, []);
    assert.deepEqual(p.tags, ["Honesty"]);
});

test("payload: simple products use nullable id_variant; weight is preserved", () => {
    const item = codItem({
        supplier_variant: { product_id: "88597", variation_id: "simple", mastershop_weight: 2 },
    });
    const built = buildMastershopCodPayload(codOrder(), [item]);
    assert.ok("payload" in built);
    if (!("payload" in built)) return;
    const items = built.payload.order_items as Record<string, unknown>[];
    assert.equal(items[0].id_variant, null);
    assert.equal(items[0].weight, 2);
});

test("payload: missing/invalid weight and mixed sources and discounts are rejected", () => {
    const noWeight = codItem({ supplier_variant: { product_id: "88597", variation_id: "195338" } });
    const r1 = buildMastershopCodPayload(codOrder(), [noWeight]);
    assert.ok("error" in r1);
    if ("error" in r1) assert.ok(r1.error.includes("peso"));

    const zeroWeight = codItem({
        supplier_variant: { product_id: "88597", variation_id: "195338", mastershop_weight: 0 },
    });
    assert.ok("error" in buildMastershopCodPayload(codOrder(), [zeroWeight]));

    const mixed = codItem({ source: "manual" });
    assert.ok("error" in buildMastershopCodPayload(codOrder(), [mixed]));

    const discounted = codOrder({ discount_cop: 5000, coupon_code: "X10" });
    assert.ok("error" in buildMastershopCodPayload(discounted, [codItem()]));

    const nonCod = codOrder({ payment_method: "wompi", payment_status: "paid" });
    assert.ok("error" in buildMastershopCodPayload(nonCod, [codItem()]));

    const noDepartment = codOrder({ department: null });
    assert.ok("error" in buildMastershopCodPayload(noDepartment, [codItem()]));

    const alphaCedula = codOrder({ customer_cedula: "AB-12345" });
    assert.ok("error" in buildMastershopCodPayload(alphaCedula, [codItem()]));
});

// --- lookup + remote normalization ------------------------------------------

test("lookup: 404 is null; matching snapshot extracts bounded fields only", async () => {
    env();
    try {
        const { fetch: notFound } = stubFetch([]);
        const miss = await lookupMastershopOrder(EXTERNAL_ID, notFound);
        assert.deepEqual(miss, { ok: true, data: null });

        const { fetch: found } = stubFetch([
            [
                "GET",
                "/api/orders",
                200,
                {
                    idOrder: 1001,
                    externalOrderId: EXTERNAL_ID,
                    status: "En tránsito",
                    carrierTrackingCode: "GUIA-9",
                    orderLogistics: { carrierName: "Interrapidísimo" },
                    customer: { full_name: "PII never stored wholesale" },
                },
            ],
        ]);
        const hit = await lookupMastershopOrder(EXTERNAL_ID, found);
        assert.ok(hit.ok && hit.data);
        if (hit.ok && hit.data) {
            assert.equal(hit.data.id, "1001");
            assert.equal(hit.data.externalId, EXTERNAL_ID);
            assert.equal(hit.data.providerStatus, "En tránsito");
            assert.equal(hit.data.trackingNumber, "GUIA-9");
            assert.equal(hit.data.carrier, "Interrapidísimo");
        }
    } finally {
        clearEnv();
    }
});

test("lookup: mismatched external id or malformed body is a generic error", async () => {
    env();
    try {
        const { fetch: mismatch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: "HON-other" }],
        ]);
        const r1 = await lookupMastershopOrder(EXTERNAL_ID, mismatch);
        assert.equal(r1.ok, false);
        const { fetch: malformed } = stubFetch([["GET", "/api/orders", 200, { nope: true }]]);
        const r2 = await lookupMastershopOrder(EXTERNAL_ID, malformed);
        assert.equal(r2.ok, false);
    } finally {
        clearEnv();
    }
});

// --- pre-submit validation ---------------------------------------------------

function itemShape(o: Record<string, unknown> = {}) {
    const i = codItem(o) as unknown as Record<string, unknown>;
    return {
        name: i.name as string,
        quantity: i.quantity as number,
        unit_price_cop: i.unit_price_cop as number,
        unit_shipping_cop: i.unit_shipping_cop as number,
        source: i.source as string,
        supplier_variant: i.supplier_variant as Record<string, unknown>,
    };
}

test("validation: membership 404, missing variant, stock and non-COP are rejected", async () => {
    env();
    try {
        // membership 404 → product not in account
        const notMember = stubFetch([]).fetch;
        const r1 = await validateMastershopCodItems([itemShape()], notMember);
        assert.ok("error" in r1);
        if ("error" in r1) assert.ok(r1.error.includes("Mis productos"));

        // variant no longer exists
        const noVariant = stubFetch([
            ["GET", "/api/products/88597", 200, membershipBody()],
            ["GET", "/api/products/market/88597", 200, detailBody({ variants: [{ idVariant: 999, name: "x", price: 1, stock: 5 }] })],
        ]).fetch;
        const r2 = await validateMastershopCodItems([itemShape()], noVariant);
        assert.ok("error" in r2);

        // stock insufficient for a single item
        const lowStock = stubFetch([
            ["GET", "/api/products/88597", 200, membershipBody()],
            ["GET", "/api/products/market/88597", 200, detailBody({ variants: [{ idVariant: 195338, name: "x", price: 52500, stock: 1 }] })],
        ]).fetch;
        const r3 = await validateMastershopCodItems([itemShape({ quantity: 2 })], lowStock);
        assert.ok("error" in r3);

        // two local rows on the same provider variant are aggregated
        const r4 = await validateMastershopCodItems(
            [itemShape({ quantity: 1 }), itemShape({ quantity: 2 })],
            stubFetch([
                ["GET", "/api/products/88597", 200, membershipBody()],
                ["GET", "/api/products/market/88597", 200, detailBody({ variants: [{ idVariant: 195338, name: "x", price: 52500, stock: 2 }] })],
            ]).fetch
        );
        assert.ok("error" in r4);

        // non-COP price is unusable for a COP order
        const usd = stubFetch([
            ["GET", "/api/products/88597", 200, membershipBody()],
            ["GET", "/api/products/market/88597", 200, detailBody({ baseCurrencyPrice: "USD" })],
        ]).fetch;
        const r5 = await validateMastershopCodItems([itemShape()], usd);
        assert.ok("error" in r5);
    } finally {
        clearEnv();
    }
});

test("validation: missing weight and mixed source reject before any fetch", async () => {
    env();
    try {
        let calls = 0;
        const counting: FetchLike = async () => {
            calls++;
            return new Response("{}", { status: 200 });
        };
        const r1 = await validateMastershopCodItems(
            [itemShape({ supplier_variant: { product_id: "88597", variation_id: "195338" } })],
            counting
        );
        assert.ok("error" in r1);
        const r2 = await validateMastershopCodItems([itemShape({ source: "manual" })], counting);
        assert.ok("error" in r2);
        assert.equal(calls, 0);
    } finally {
        clearEnv();
    }
});

// --- placement ---------------------------------------------------------------

function happyFetch(created: Record<string, unknown> | Response | null) {
    return stubFetch([
        ["GET", "/api/products/88597", 200, membershipBody()],
        ["GET", "/api/products/market/88597", 200, detailBody()],
        ["GET", "/api/orders", 404, { error: "nf" }],
        ["POST", "/api/orders", created === null ? 500 : 200, created ?? { error: "x" }],
    ]);
}

test("fresh COD order posts exactly once, stores ref and never marks paid", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db);
        const { fetch, calls } = happyFetch({
            idOrder: 1001,
            externalOrderId: EXTERNAL_ID,
            status: "Por Confirmar",
            orderTransaction: { payment_method: "cod" },
        });
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res, JSON.stringify(res));
        if (!("ok" in res)) return;
        assert.equal(res.supplierOrderId, "mastershop:1001");
        assert.equal(res.alreadyPlaced, false);
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_id, "mastershop:1001");
        assert.equal(row.supplier_order_status, "submitted");
        assert.equal(row.payment_status, "cod_pending"); // never paid
        assert.equal(row.fulfillment_status, "awaiting_confirmation");
        const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/api/orders"));
        assert.equal(posts.length, 1);
        const payload = JSON.parse(posts[0].body);
        assert.equal(payload.id_order, EXTERNAL_ID);
        assert.equal(payload.order_transaction.payment_method, "cod");
    } finally {
        clearEnv();
    }
});

test("idempotency: already-submitted and young-submitting orders never POST", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_id: "mastershop:1001",
            supplier_order_status: "submitted",
            auto_fulfill_attempts: 1,
        });
        const { fetch, calls } = happyFetch({ idOrder: 1001, externalOrderId: EXTERNAL_ID });
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res && res.alreadyPlaced);
        assert.equal(calls.length, 0);

        const db2 = new FakeDb();
        seed(db2, {
            supplier_order_status: "submitting",
            auto_fulfill_attempts: 1,
            updated_at: new Date().toISOString(), // fresh — a worker may be in flight
        });
        const res2 = await placeMastershopCodOrder(ORDER_ID, db2.asClient(), fetch);
        assert.ok("error" in res2);
        assert.equal(calls.length, 0);
    } finally {
        clearEnv();
    }
});

test("attempted-but-ambiguous orders only GET: lookup found reattaches, 404 never reposts", async () => {
    env();
    try {
        // stale submitting + attempts=1 → previous POST outcome unknown
        const db = new FakeDb();
        seed(db, {
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
            updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        });
        const { fetch: found, calls: foundCalls } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Por Confirmar" }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), found);
        assert.ok("ok" in res);
        if ("ok" in res) assert.equal(res.supplierOrderId, "mastershop:1001");
        assert.equal(db.table("orders")[0].supplier_order_status, "submitted");
        assert.equal(foundCalls.filter((c) => c.method === "POST").length, 0);

        // lookup 404 after an attempt → error, reconciliation, NEVER a POST
        const db2 = new FakeDb();
        seed(db2, {
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
        });
        const { fetch: miss, calls: missCalls } = stubFetch([]);
        const res2 = await placeMastershopCodOrder(ORDER_ID, db2.asClient(), miss);
        assert.ok("error" in res2);
        assert.equal(missCalls.filter((c) => c.method === "POST").length, 0);
        assert.equal(db2.table("orders")[0].supplier_order_status, "reconciliation_required");
    } finally {
        clearEnv();
    }
});

test("timeout/5xx on create parks the order in reconciliation; never reposts", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db);
        // POST fails (network error → undefined status)
        const { fetch, calls } = stubFetch([
            ["GET", "/api/products/88597", 200, membershipBody()],
            ["GET", "/api/products/market/88597", 200, detailBody()],
            ["GET", "/api/orders", 404, { error: "nf" }],
            ["POST", "/api/orders", new Response("bad", { status: 500 })],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("error" in res);
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_status, "reconciliation_required");
        assert.equal(row.auto_fulfill_attempts, 1);

        // next pass: GET-only — the provider actually stored it
        const { fetch: found } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Por Confirmar" }],
        ]);
        const res2 = await placeMastershopCodOrder(ORDER_ID, db.asClient(), found);
        assert.ok("ok" in res2);
        assert.equal(db.table("orders")[0].supplier_order_id, "mastershop:1001");
        assert.equal(calls.filter((c) => c.method === "POST").length, 1); // single POST ever
    } finally {
        clearEnv();
    }
});

test("malformed or mismatched create response → reconciliation, generic error", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db);
        const { fetch } = happyFetch({ unexpected: true });
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("error" in res);
        assert.equal(db.table("orders")[0].supplier_order_status, "reconciliation_required");

        const db2 = new FakeDb();
        seed(db2);
        const { fetch: mismatch } = happyFetch({ idOrder: 1001, externalOrderId: "HON-other" });
        const res2 = await placeMastershopCodOrder(ORDER_ID, db2.asClient(), mismatch);
        assert.ok("error" in res2);
        assert.equal(db2.table("orders")[0].supplier_order_status, "reconciliation_required");
    } finally {
        clearEnv();
    }
});

test("local persist failure after remote creation reports an error, never success", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, { supplier_order_status: "reconciliation_required", auto_fulfill_attempts: 1 });
        db.failUpdates.add("orders"); // CAS/persist fails
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("error" in res);
        assert.equal(db.table("orders")[0].supplier_order_id, null);
    } finally {
        clearEnv();
    }
});

test("feature gate blocks fresh placement but read-only reconciliation still works", async () => {
    env();
    try {
        process.env.MASTERSHOP_COD_ENABLED = "false";
        const db = new FakeDb();
        seed(db); // fresh queued order
        const { fetch, calls } = happyFetch({ idOrder: 1001, externalOrderId: EXTERNAL_ID });
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("error" in res);
        assert.equal(calls.length, 0);

        // attempted order still reconciles via GET while the flag is off
        const db2 = new FakeDb();
        seed(db2, { supplier_order_status: "reconciliation_required", auto_fulfill_attempts: 1 });
        const { fetch: found } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID }],
        ]);
        const res2 = await placeMastershopCodOrder(ORDER_ID, db2.asClient(), found);
        assert.ok("ok" in res2);
    } finally {
        clearEnv();
    }
});

test("wompi orders are rejected before any provider call", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, { payment_method: "wompi", payment_status: "paid" });
        let calls = 0;
        const counting: FetchLike = async () => {
            calls++;
            return new Response("{}", { status: 200 });
        };
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), counting);
        assert.ok("error" in res);
        assert.equal(calls, 0);
    } finally {
        clearEnv();
    }
});

// --- tracking sync -----------------------------------------------------------

test("remote status mapping follows the documented status ids/names", () => {
    const cases: [string, string][] = [
        ["1", "awaiting_confirmation"],
        ["Por Confirmar", "awaiting_confirmation"],
        ["Pendiente", "supplier_processing"],
        ["Por Alistar", "supplier_processing"],
        ["4", "supplier_processing"],
        ["Recolectada", "domestic_transit"],
        ["En tránsito", "domestic_transit"],
        ["Entregada", "delivered"],
        ["Cancelada", "cancelled"],
        ["Devuelta", "returned"],
        ["weird", "unknown"],
    ];
    for (const [raw, kind] of cases) {
        const m = mapMastershopRemoteStatus(raw);
        assert.equal(m.kind, kind === "delivered" || kind === "cancelled" || kind === "returned" || kind === "unknown" ? kind : "fulfillment", raw);
        if (m.kind === "fulfillment") assert.equal(m.status, kind);
    }
});

function submittedOrder(overrides: Record<string, unknown> = {}) {
    return codOrder({
        supplier_order_id: "mastershop:1001",
        supplier_order_status: "submitted",
        auto_fulfill_attempts: 1,
        ...overrides,
    });
}

test("tracking sync advances fulfillment, keeps tracking and dedupes status events", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(submittedOrder() as unknown as Record<string, unknown>);
        const { fetch } = stubFetch([
            [
                "GET",
                "/api/orders",
                200,
                { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "En tránsito", carrierTrackingCode: "G-1", carrierName: "Coordinadora" },
            ],
        ]);
        const order = db.table("orders")[0] as unknown as OrderRow;
        const res = await syncMastershopTracking(order, db.asClient(), fetch);
        assert.ok("ok" in res);
        if (!("ok" in res)) return;
        assert.equal(res.trackingNumber, "G-1");
        assert.equal(res.carrier, "Coordinadora");
        assert.equal(res.fulfillmentAdvanced, true);
        const row = db.table("orders")[0];
        assert.equal(row.fulfillment_status, "domestic_transit");
        assert.equal(row.mastershop_status, "En tránsito");
        assert.equal(row.payment_status, "cod_pending");
        // first sync records two distinct facts: guide registered + transition
        assert.equal(db.table("order_events").length, 2);

        // same provider status again → no duplicate events
        const res2 = await syncMastershopTracking(
            db.table("orders")[0] as unknown as OrderRow,
            db.asClient(),
            fetch
        );
        assert.ok("ok" in res2);
        assert.equal(db.table("order_events").length, 2);
    } finally {
        clearEnv();
    }
});

test("remote Cancelada cancels the COD order via authenticated proof", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(submittedOrder() as unknown as Record<string, unknown>);
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Cancelada" }],
        ]);
        const res = await syncMastershopTracking(
            db.table("orders")[0] as unknown as OrderRow,
            db.asClient(),
            fetch
        );
        assert.ok("ok" in res);
        const row = db.table("orders")[0];
        assert.equal(row.payment_status, "cancelled");
        assert.equal(row.fulfillment_status, "cancelled");
    } finally {
        clearEnv();
    }
});

test("remote Entregada notes unverified collection — never paid or delivered", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(submittedOrder() as unknown as Record<string, unknown>);
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Entregada" }],
        ]);
        const res = await syncMastershopTracking(
            db.table("orders")[0] as unknown as OrderRow,
            db.asClient(),
            fetch
        );
        assert.ok("ok" in res);
        const row = db.table("orders")[0];
        assert.equal(row.payment_status, "cod_pending");
        assert.equal(row.fulfillment_status, "awaiting_confirmation");
        const events = db.table("order_events");
        assert.equal(events.length, 1);
        assert.ok(String(events[0].description).includes("recaudo sin verificar"));
    } finally {
        clearEnv();
    }
});

test("remote Devuelta parks reconciliation — never refunded", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(submittedOrder() as unknown as Record<string, unknown>);
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Devuelta" }],
        ]);
        const res = await syncMastershopTracking(
            db.table("orders")[0] as unknown as OrderRow,
            db.asClient(),
            fetch
        );
        assert.ok("ok" in res);
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_status, "reconciliation_required");
        assert.notEqual(row.payment_status, "refunded");
        assert.equal(row.payment_status, "cod_pending");
    } finally {
        clearEnv();
    }
});

test("sync verifies the remote id matches the stored supplier ref", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(submittedOrder() as unknown as Record<string, unknown>);
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 2222, externalOrderId: EXTERNAL_ID }],
        ]);
        const res = await syncMastershopTracking(
            db.table("orders")[0] as unknown as OrderRow,
            db.asClient(),
            fetch
        );
        assert.ok("error" in res);
    } finally {
        clearEnv();
    }
});

// --- create_cod_order RPC glue ------------------------------------------------

const ATTEMPT_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";

function rpcDb(handler: (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } }) {
    return {
        from: () => ({ select: () => ({}) }),
        rpc: (fn: string, args: Record<string, unknown>) => {
            assert.equal(fn, "create_cod_order");
            return Promise.resolve(handler(args));
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

const COD_PRICING = {
    items: [
        {
            productId: "ms-1",
            name: "Item",
            unitPriceCop: 50000,
            quantity: 2,
            unitShippingCop: 5000,
            unitSupplierCostCop: null,
            source: "mastershop",
            supplierVariant: { product_id: "1", variation_id: "2", mastershop_weight: 1 },
        },
    ],
    subtotalCop: 100000,
    discountCop: 0,
    shippingCop: 10000,
    totalCop: 110000,
    couponCode: null,
};
const COD_CUSTOMER = {
    name: "Ana Prueba",
    email: "a@b.co",
    phone: "3001234567",
    cedula: "1020",
    address: "Calle 1",
    city: "Bogotá",
    department: "Cundinamarca",
    notes: null,
};

test("createCodOrder passes validated payload and returns order/reused", async () => {
    const order = { id: "o-1", ref: "LM-1" };
    const client = rpcDb((args) => {
        const pOrder = args.p_order as Record<string, unknown>;
        assert.equal(pOrder.checkout_attempt_id, ATTEMPT_ID);
        assert.equal(pOrder.payment_method, undefined); // method is set by the RPC itself
        assert.equal(typeof pOrder.cart_fingerprint, "string");
        const items = args.p_items as Record<string, unknown>[];
        assert.equal(items[0].source, "mastershop");
        return { data: { order, reused: false } };
    });
    const res = await createCodOrder(COD_CUSTOMER, COD_PRICING, NOW, ATTEMPT_ID, client);
    assert.ok("ok" in res);
    if ("ok" in res) {
        assert.equal(res.order.id, "o-1");
        assert.equal(res.reused, false);
    }
});

test("createCodOrder: attempt conflict and rate limit map to friendly errors", async () => {
    const conflict = await createCodOrder(
        COD_CUSTOMER,
        COD_PRICING,
        NOW,
        ATTEMPT_ID,
        rpcDb(() => ({ error: { message: "checkout attempt changed" } }))
    );
    assert.ok("error" in conflict);
    if ("error" in conflict) assert.ok(conflict.error.includes("cambió"));

    const limited = await createCodOrder(
        COD_CUSTOMER,
        COD_PRICING,
        NOW,
        ATTEMPT_ID,
        rpcDb(() => ({ error: { message: "too many requests" } }))
    );
    assert.ok("error" in limited);
    if ("error" in limited) assert.ok(limited.error.includes("Demasiados"));

    const sql = await createCodOrder(
        COD_CUSTOMER,
        COD_PRICING,
        NOW,
        ATTEMPT_ID,
        rpcDb(() => ({ error: { message: "relation orders does not exist; SQLSTATE 42P01 secret" } }))
    );
    assert.ok("error" in sql);
    if ("error" in sql) {
        assert.ok(!sql.error.includes("SQLSTATE"));
        assert.ok(!sql.error.includes("secret"));
    }

    assert.ok("error" in await createCodOrder(COD_CUSTOMER, COD_PRICING, NOW, "not-a-uuid", rpcDb(() => ({}))));
});

test("codRequestFingerprint is request-based: price/stock refresh reuses, cart change rejects", () => {
    const items = COD_PRICING.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    const a = codRequestFingerprint(COD_CUSTOMER, items);
    const b = codRequestFingerprint({ ...COD_CUSTOMER }, [...items]);
    assert.equal(a, b);

    // A provider-side refresh (stock, weight, fetched_at, prices, totals)
    // must not change the request fingerprint — retries converge on the
    // original order.
    const repriced = COD_PRICING.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    assert.equal(a, codRequestFingerprint(COD_CUSTOMER, repriced));

    // A changed cart or customer is a different request.
    const qtyChange = items.map((i) => ({ ...i, quantity: i.quantity + 1 }));
    assert.notEqual(a, codRequestFingerprint(COD_CUSTOMER, qtyChange));
    const customerChange = { ...COD_CUSTOMER, address: "Carrera 9" };
    assert.notEqual(a, codRequestFingerprint(customerChange, items));
    // Cosmetic whitespace differences normalize away.
    const cosmetic = { ...COD_CUSTOMER, name: "  Ana   Prueba " };
    assert.equal(a, codRequestFingerprint(cosmetic, items));
});

test("findExistingCodOrder: matching attempt returns order, changed request conflicts", async () => {
    const items = [{ productId: "ms-1", quantity: 2 }];
    const fingerprint = codRequestFingerprint(COD_CUSTOMER, items);
    const order = codOrder({
        checkout_attempt_id: ATTEMPT_ID,
        cart_fingerprint: fingerprint,
        subtotal_cop: 100000,
        shipping_cop: 10000,
        total_cop: 110000,
    });

    const db = new FakeDb();
    db.table("orders").push(order as unknown as Record<string, unknown>);
    const found = await findExistingCodOrder(COD_CUSTOMER, items, ATTEMPT_ID, db.asClient());
    assert.ok("order" in found);
    if ("order" in found) assert.equal(found.order?.id, order.id);

    // Changed cart on the same attempt → conflict, no order disclosed.
    const conflict = await findExistingCodOrder(
        COD_CUSTOMER,
        [{ productId: "ms-1", quantity: 3 }],
        ATTEMPT_ID,
        db.asClient()
    );
    assert.ok("error" in conflict);

    // Unknown attempt → null, the new flow proceeds.
    const missing = await findExistingCodOrder(
        COD_CUSTOMER,
        items,
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        db.asClient()
    );
    assert.ok("order" in missing && missing.order === null);

    // A non-COD row under the attempt id never discloses.
    const db2 = new FakeDb();
    db2.table("orders").push(
        codOrder({ checkout_attempt_id: ATTEMPT_ID, cart_fingerprint: fingerprint, payment_method: "wompi", payment_status: "paid" }) as unknown as Record<string, unknown>
    );
    assert.ok("error" in (await findExistingCodOrder(COD_CUSTOMER, items, ATTEMPT_ID, db2.asClient())));
});

// --- CAS / concurrency hardening --------------------------------------------

test("concurrent placements: exactly one provider POST even with frozen timestamps", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db);
        const { fetch, calls } = happyFetch({
            idOrder: 1001,
            externalOrderId: EXTERNAL_ID,
            status: "Por Confirmar",
        });
        // Freeze the clock so both workers compute the identical updated_at —
        // the claim guards (attempts=0 + status + payment guards) decide.
        const realNow = Date.now;
        Date.now = () => Date.parse(NOW);
        let results: Awaited<ReturnType<typeof placeMastershopCodOrder>>[] = [];
        try {
            results = await Promise.all([
                placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch),
                placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch),
            ]);
        } finally {
            Date.now = realNow;
        }
        const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/api/orders"));
        assert.equal(posts.length, 1);
        assert.equal(results.filter((r) => "ok" in r).length, 1);
        assert.equal(db.table("orders")[0].supplier_order_id, "mastershop:1001");
    } finally {
        clearEnv();
    }
});

test("reattach preserves an advanced local stage — never resets to awaiting_confirmation", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
            fulfillment_status: "domestic_transit",
            mastershop_status: "En tránsito",
        });
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Por Confirmar" }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res, JSON.stringify(res));
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_id, "mastershop:1001");
        assert.equal(row.fulfillment_status, "domestic_transit");
    } finally {
        clearEnv();
    }
});

test("remote Devuelta on reattach stays in reconciliation — never treated as fresh attach", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
            fulfillment_status: "domestic_transit",
        });
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Devuelta" }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res, JSON.stringify(res));
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_id, "mastershop:1001");
        assert.equal(row.supplier_order_status, "reconciliation_required");
        assert.equal(row.fulfillment_status, "domestic_transit");
        assert.equal(row.payment_status, "cod_pending"); // never refunded
    } finally {
        clearEnv();
    }
});

test("remote Cancelada found on reattach cancels via authenticated proof", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, { supplier_order_status: "reconciliation_required", auto_fulfill_attempts: 1 });
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Cancelada" }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res, JSON.stringify(res));
        const row = db.table("orders")[0];
        assert.equal(row.payment_status, "cancelled");
        assert.equal(row.fulfillment_status, "cancelled");
        const evt = db.table("order_events").find((e) => e.status === "cancelled");
        assert.ok(evt);
        assert.ok(String(evt.description).includes("recaudo no se ha verificado") || String(evt.description).includes("estado de recaudo"));
        assert.ok(!String(evt.description).includes("no hubo cobro"));
    } finally {
        clearEnv();
    }
});

test("syncMastershopTracking rejects non-COD and locally closed orders before any fetch", async () => {
    env();
    try {
        const db = new FakeDb();
        let calls = 0;
        const counting: FetchLike = async () => {
            calls++;
            return new Response("{}", { status: 200 });
        };
        const nonCod = submittedOrder({ payment_method: "wompi" });
        assert.ok("error" in (await syncMastershopTracking(nonCod, db.asClient(), counting)));
        const cancelled = submittedOrder({ fulfillment_status: "cancelled" });
        assert.ok("error" in (await syncMastershopTracking(cancelled, db.asClient(), counting)));
        const refunded = submittedOrder({ payment_status: "refunded" });
        assert.ok("error" in (await syncMastershopTracking(refunded, db.asClient(), counting)));
        assert.equal(calls, 0);
    } finally {
        clearEnv();
    }
});

// --- shared customer contract ------------------------------------------------

test("validateMastershopCodCustomer enforces the provider contract consistently", () => {
    const base = {
        name: "Ana Prueba",
        email: "a@b.co",
        phone: "3001234567",
        cedula: "1020304050",
        address: "Calle 1",
        city: "Bogotá",
        department: "Cundinamarca",
        notes: null,
    };
    assert.equal(validateMastershopCodCustomer(base), null);
    // Docs accept Unicode letters and spaces only — hyphens/apostrophes reject.
    assert.ok(validateMastershopCodCustomer({ ...base, name: "Mary-Ann O'Brien" }));
    assert.ok(validateMastershopCodCustomer({ ...base, department: "AB" }));
    assert.ok(validateMastershopCodCustomer({ ...base, cedula: "CC-1234" }));
    assert.ok(validateMastershopCodCustomer({ ...base, phone: "123" }));
    // Same rule applies inside the payload builder.
    assert.ok(
        "error" in buildMastershopCodPayload(codOrder({ customer_name: "Mary-Ann" }), [codItem()])
    );
});

// --- narrowed RPC retry + admin COD cancel ------------------------------------

test("createCodOrder retries only orders_ref_key collisions, not other uniques", async () => {
    let calls = 0;
    const refCollision = rpcDb(() => {
        calls++;
        if (calls === 1) return { error: { message: 'duplicate key value violates unique constraint "orders_ref_key"' } };
        return { data: { order: { id: "o-2", ref: "LM-2" }, reused: false } };
    });
    const res = await createCodOrder(COD_CUSTOMER, COD_PRICING, NOW, ATTEMPT_ID, refCollision);
    assert.ok("ok" in res);
    assert.equal(calls, 2);

    let calls2 = 0;
    const attemptCollision = rpcDb(() => {
        calls2++;
        return { error: { message: 'duplicate key value violates unique constraint "orders_checkout_attempt_id_key"' } };
    });
    const res2 = await createCodOrder(COD_CUSTOMER, COD_PRICING, NOW, ATTEMPT_ID, attemptCollision);
    assert.ok("error" in res2);
    assert.equal(calls2, 1); // never retried — a duplicate attempt is not a ref race
});

test("createCodOrder catches transport throws and returns a generic error", async () => {
    const throwing = {
        from: () => ({ select: () => ({}) }),
        rpc: () => Promise.reject(new Error("socket hangup")),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const res = await createCodOrder(COD_CUSTOMER, COD_PRICING, NOW, ATTEMPT_ID, throwing);
    assert.ok("error" in res);
    if ("error" in res) assert.ok(!res.error.includes("socket"));
});

test("admin cancel: COD pre-submit is allowed, attempted COD is refused; status update cannot bypass", async () => {
    // Safe pre-submit cancel: queued + attempts 0 + no remote ref.
    const db = new FakeDb();
    db.table("orders").push(codOrder() as unknown as Record<string, unknown>);
    const res = await updateOrderAdmin(ORDER_ID, { action: "cancel" }, db.asClient());
    assert.ok("ok" in res, JSON.stringify(res));
    const row = db.table("orders")[0];
    assert.equal(row.payment_status, "cancelled");
    assert.equal(row.fulfillment_status, "cancelled");

    // Attempted orders must still go through Mastershop.
    const db2 = new FakeDb();
    db2.table("orders").push(
        codOrder({ auto_fulfill_attempts: 1, supplier_order_status: "reconciliation_required" }) as unknown as Record<string, unknown>
    );
    const res2 = await updateOrderAdmin(ORDER_ID, { action: "cancel" }, db2.asClient());
    assert.ok("error" in res2);
    if ("error" in res2) assert.ok(res2.error.includes("Cancela en Mastershop"));

    // A plain fulfillment update cannot sneak 'cancelled' past the guard.
    const db3 = new FakeDb();
    db3.table("orders").push(codOrder() as unknown as Record<string, unknown>);
    const res3 = await updateOrderAdmin(ORDER_ID, { fulfillmentStatus: "cancelled" }, db3.asClient());
    assert.ok("error" in res3);
    assert.equal(db3.table("orders")[0].fulfillment_status, "awaiting_confirmation");

    // CAS: a concurrent submit changes attempts/status → cancel loses safely.
    const db4 = new FakeDb();
    db4.table("orders").push(codOrder() as unknown as Record<string, unknown>);
    db4.table("orders")[0].supplier_order_status = "submitting";
    const res4 = await updateOrderAdmin(ORDER_ID, { action: "cancel" }, db4.asClient());
    assert.ok("error" in res4);
});

test("strict integers: fractional quantity or totals are rejected", () => {
    const fracQty = codItem({ quantity: 1.5 });
    assert.ok("error" in buildMastershopCodPayload(codOrder(), [fracQty]));
    const negPrice = codItem({ unit_price_cop: -1 });
    assert.ok("error" in buildMastershopCodPayload(codOrder(), [negPrice]));
});

test("existing remote ref: repeated reconcile never re-registers or resets attention", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_id: "mastershop:1001",
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
            mastershop_status: "Devuelta",
            fulfillment_status: "domestic_transit",
        });
        const { fetch, calls } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Devuelta" }],
        ]);
        const registrations = () =>
            db.table("order_events").filter((e) => String(e.label).includes("registrado")).length;

        const r1 = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in r1, JSON.stringify(r1));
        if ("ok" in r1) {
            assert.equal(r1.supplierOrderId, "mastershop:1001");
            assert.equal(r1.alreadyPlaced, true);
        }
        let row = db.table("orders")[0];
        assert.equal(row.supplier_order_id, "mastershop:1001");
        assert.equal(row.supplier_order_status, "reconciliation_required"); // Devuelta latches
        assert.equal(row.fulfillment_status, "domestic_transit");
        assert.equal(registrations(), 0); // re-attach path never ran

        // Identical second poll: no registration event, no repeated return note.
        const r2 = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in r2);
        row = db.table("orders")[0];
        assert.equal(registrations(), 0);
        assert.equal(db.table("order_events").length, 0);
        assert.equal(row.supplier_order_status, "reconciliation_required");
        assert.equal(calls.filter((c) => c.method === "POST").length, 0);
    } finally {
        clearEnv();
    }
});

test("existing remote ref: recognized status resolves ambiguity to submitted", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_id: "mastershop:1001",
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
            mastershop_status: "Por Confirmar",
        });
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Por Alistar" }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("ok" in res, JSON.stringify(res));
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_status, "submitted");
        assert.equal(row.fulfillment_status, "supplier_processing");
        assert.equal(row.mastershop_status, "Por Alistar");
    } finally {
        clearEnv();
    }
});

test("stored remote id mismatch: generic error, zero writes, zero posts", async () => {
    env();
    try {
        const db = new FakeDb();
        seed(db, {
            supplier_order_id: "mastershop:9999",
            supplier_order_status: "reconciliation_required",
            auto_fulfill_attempts: 1,
        });
        const { fetch, calls } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID }],
        ]);
        const res = await placeMastershopCodOrder(ORDER_ID, db.asClient(), fetch);
        assert.ok("error" in res);
        const row = db.table("orders")[0];
        assert.equal(row.supplier_order_id, "mastershop:9999");
        assert.equal(row.supplier_order_status, "reconciliation_required");
        assert.equal(db.table("order_events").length, 0);
        assert.equal(calls.filter((c) => c.method === "POST").length, 0);
    } finally {
        clearEnv();
    }
});

test("frozen clock: sync updated_at stays strictly monotonic", async () => {
    env();
    try {
        const db = new FakeDb();
        db.table("orders").push(
            submittedOrder({ updated_at: NOW, supplier_synced_at: null }) as unknown as Record<string, unknown>
        );
        const { fetch } = stubFetch([
            ["GET", "/api/orders", 200, { idOrder: 1001, externalOrderId: EXTERNAL_ID, status: "Pendiente" }],
        ]);
        const realNow = Date.now;
        Date.now = () => Date.parse(NOW);
        try {
            const res = await syncMastershopTracking(
                db.table("orders")[0] as unknown as OrderRow,
                db.asClient(),
                fetch
            );
            assert.ok("ok" in res, JSON.stringify(res));
        } finally {
            Date.now = realNow;
        }
        const row = db.table("orders")[0];
        // Date.now is frozen at NOW, so the monotonic stamp must be strictly
        // later than the previous updated_at (prev + 1ms) rather than equal.
        const updatedAt = row.updated_at as string;
        assert.ok(Date.parse(updatedAt) > Date.parse(NOW), `updated_at ${updatedAt} not > ${NOW}`);
    } finally {
        clearEnv();
    }
});

test("request fingerprint: email case and phone formatting normalize identically", () => {
    const items = [{ productId: "ms-1", quantity: 2 }];
    const a = codRequestFingerprint(COD_CUSTOMER, items);
    assert.equal(a, codRequestFingerprint({ ...COD_CUSTOMER, email: "A@B.CO" }, items));
    assert.equal(a, codRequestFingerprint({ ...COD_CUSTOMER, phone: "300 123 4567" }, items));
    assert.equal(a, codRequestFingerprint({ ...COD_CUSTOMER, phone: "(300) 123-4567" }, items));
});
