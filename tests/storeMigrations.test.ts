import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    BLANK_PROFILE,
    SEEDED_ABANDONED_CART_IDS,
    SEEDED_LOYALTY_TX_IDS,
    SEEDED_PRODUCT_IDS,
    SEEDED_TASK_IDS,
    isSeededProfile,
    migrateCartPersisted,
    migrateLoyaltyPersisted,
    migrateOperatorPersisted,
} from "../store/migrations.ts";

const DEMO_PROFILE = {
    name: "Carolina Mejia",
    email: "carolina.mejia@gmail.com",
    phone: "3104567890",
    address: "Calle 127 #15-32 Apto 402",
    city: "Bogotá",
    department: "Cundinamarca",
    cedula: "1018459203",
    notes: "Dejar en portería con vigilancia",
};

test("operator migration strips seeded carts/tasks and resets seeded checklist", () => {
    const checklistDefaults = [
        { id: "chk-1", title: "Real task", completed: false },
        { id: "chk-2", title: "Other", completed: false },
    ];
    const persisted = {
        abandonedCarts: [{ id: "AB-3021" }, { id: "AB-2940" }, { id: "AB-7777" }],
        tasks: [{ id: "tsk-1" }, { id: "tsk-2" }, { id: "tsk-3" }, { id: "real-1" }],
        launchChecklist: [
            { id: "chk-1", title: "Stale copy", completed: true },
            { id: "chk-9", title: "Custom", completed: true },
        ],
    };
    const out = migrateOperatorPersisted(persisted, checklistDefaults) as Record<
        string,
        { id: string; completed?: boolean }[]
    >;
    assert.deepEqual(out.abandonedCarts.map((c) => c.id), ["AB-7777"]);
    assert.deepEqual(out.tasks.map((t) => t.id), ["real-1"]);
    assert.deepEqual(out.launchChecklist, [
        { id: "chk-1", title: "Real task", completed: false },
        { id: "chk-9", title: "Custom", completed: true },
    ]);
    for (const id of [...SEEDED_ABANDONED_CART_IDS, ...SEEDED_TASK_IDS]) {
        assert.ok(!JSON.stringify(out).includes(`"${id}"`));
    }
});

test("loyalty migration deducts only seeded tx points and clamps at zero", () => {
    const persisted = {
        account: {
            points: 500,
            lifetimePoints: 500,
            tier: "plata",
            referralCode: "LUZ-CAROLINA",
            history: [
                { id: "tx-1", type: "earned", points: 150 },
                { id: "tx-2", type: "earned", points: 200 },
                { id: "real-9", type: "earned", points: 300 },
            ],
        },
    };
    const out = migrateLoyaltyPersisted(persisted) as {
        account: {
            points: number;
            lifetimePoints: number;
            tier: string;
            referralCode: string;
            history: { id: string }[];
        };
    };
    assert.equal(out.account.points, 150); // 500 - 350
    assert.equal(out.account.lifetimePoints, 150);
    assert.equal(out.account.tier, "bronce");
    assert.equal(out.account.referralCode, "");
    assert.deepEqual(out.account.history.map((t) => t.id), ["real-9"]);
    for (const id of SEEDED_LOYALTY_TX_IDS) {
        assert.ok(!out.account.history.some((t) => t.id === id));
    }
});

test("loyalty migration clamps seeded deduction at zero and keeps real code", () => {
    const persisted = {
        account: {
            points: 100,
            lifetimePoints: 120,
            tier: "bronce",
            referralCode: "REAL-CODE",
            history: [
                { id: "tx-1", points: 150 },
                { id: "tx-2", points: 200 },
            ],
        },
    };
    const out = migrateLoyaltyPersisted(persisted) as {
        account: { points: number; lifetimePoints: number; referralCode: string };
    };
    assert.equal(out.account.points, 0);
    assert.equal(out.account.lifetimePoints, 0);
    assert.equal(out.account.referralCode, "REAL-CODE");
});

test("cart migration removes seed product ids but keeps imported items", () => {
    const persisted = {
        items: [
            { product: { id: "1" }, quantity: 1 },
            { product: { id: "8" }, quantity: 2 },
            { product: { id: "aliexpress_ds:1005" }, quantity: 1 },
            { product: { id: "cjdropshipping:77" }, quantity: 1 },
        ],
        customerProfile: { name: "Ana" },
        couponCode: "MAGIA10",
    };
    const out = migrateCartPersisted(persisted) as {
        items: { product: { id: string } }[];
        customerProfile: { name: string };
        couponCode: string;
    };
    assert.deepEqual(
        out.items.map((i) => i.product.id).sort(),
        ["aliexpress_ds:1005", "cjdropshipping:77"],
    );
    for (const id of SEEDED_PRODUCT_IDS) {
        assert.ok(!out.items.some((i) => i.product.id === id));
    }
    assert.equal(out.customerProfile.name, "Ana");
    assert.equal(out.couponCode, "MAGIA10");
});

test("cart migration blanks the demo profile only on exact full match", () => {
    const exact = migrateCartPersisted({ customerProfile: { ...DEMO_PROFILE } }) as {
        customerProfile: typeof DEMO_PROFILE;
    };
    assert.deepEqual(exact.customerProfile, { ...BLANK_PROFILE });

    // Same person minus a field must NOT be wiped — it may be a real profile
    const partial = migrateCartPersisted({
        customerProfile: { ...DEMO_PROFILE, notes: "" },
    }) as { customerProfile: typeof DEMO_PROFILE };
    assert.equal(partial.customerProfile.name, "Carolina Mejia");
    assert.equal(partial.customerProfile.notes, "");

    assert.equal(isSeededProfile({ ...DEMO_PROFILE }), true);
    assert.equal(isSeededProfile({ ...DEMO_PROFILE, city: "Cali" }), false);
    assert.equal(isSeededProfile(null), false);
});

test("seed archive migration archives exact ids without deleting", () => {
    const sql = readFileSync(
        resolve(process.cwd(), "supabase/migrations/20261006221448_archive_seed_products.sql"),
        "utf8",
    );
    assert.match(sql, /update\s+public\.catalog_products/i);
    assert.match(sql, /status\s*=\s*'archived'/i);
    assert.match(sql, /source\s*=\s*'seed'/i);
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
        assert.ok(sql.includes(`'${id}'`));
    }
    assert.doesNotMatch(sql, /\bdelete\b/i);
    assert.doesNotMatch(sql, /\btruncate\b/i);
    assert.doesNotMatch(sql, /\bdrop\b/i);
});

test("checkout submits to the real orders API and never fabricates payment state", () => {
    const src = readFileSync(
        resolve(process.cwd(), "app/checkout/CheckoutClient.tsx"),
        "utf8",
    );
    // server-side order creation via the API, never a local order record
    assert.ok(src.includes('"/api/orders"'));
    assert.ok(!src.includes("createOrder"));
    assert.ok(!src.includes("awardPoints"));
    assert.ok(!src.includes("useOrderStore"));
    assert.ok(!src.includes("markCartRecovered"));
    // redirect only to the Wompi-hosted URL returned by the server
    assert.ok(src.includes("data.checkoutUrl"));
    // data-processing consent is required before creating an order
    assert.ok(src.includes("consent"));
    // browser-local points are never sent as payment input
    assert.ok(!src.includes("pointsRedeemed:"));
});

test("the browser-local order store is retired from the codebase", () => {
    assert.throws(() =>
        readFileSync(resolve(process.cwd(), "store/useOrderStore.ts"), "utf8"),
    );
    for (const file of [
        "app/checkout/CheckoutClient.tsx",
        "app/tracking/TrackingClient.tsx",
        "app/account/AccountClient.tsx",
        "app/operator/OperatorClient.tsx",
        "components/retention/OrderAgainSection.tsx",
    ]) {
        const src = readFileSync(resolve(process.cwd(), file), "utf8");
        assert.ok(!src.includes("useOrderStore"), `${file} still uses the local order store`);
    }
});

test("support/recovery URLs have no hardcoded phone or domain", () => {
    const operator = readFileSync(
        resolve(process.cwd(), "store/useOperatorStore.ts"),
        "utf8",
    );
    assert.ok(!operator.includes("573100000000"));
    assert.ok(!operator.includes("luzmagica.co"));
    assert.ok(operator.includes("publicSiteOrigin()"));
    assert.ok(operator.includes("searchParams.set"));

    for (const file of [
        "app/tracking/TrackingClient.tsx",
        "components/retention/ExitIntentRecoveryModal.tsx",
        "components/loyalty/LoyaltyModal.tsx",
    ]) {
        const src = readFileSync(resolve(process.cwd(), file), "utf8");
        assert.ok(!src.includes("573104567890"), `${file} still has placeholder phone`);
        assert.ok(!src.includes("luzmagica.co"), `${file} still has fake domain`);
    }
});

test("contact helpers hide WhatsApp links without a configured number", async () => {
    const contact = await import("../lib/contact.ts");

    delete process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
    assert.equal(contact.supportWhatsAppDigits(), null);
    assert.equal(contact.buildSupportWhatsAppUrl("hola"), null);

    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP = "57 300 123 4567";
    assert.equal(contact.supportWhatsAppDigits(), "573001234567");
    const url = contact.buildSupportWhatsAppUrl("Hola mundo");
    assert.ok(url?.startsWith("https://wa.me/573001234567?text="));
    assert.ok(url?.includes("Hola"));

    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP = "123";
    assert.equal(contact.supportWhatsAppDigits(), null);
    delete process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
});
