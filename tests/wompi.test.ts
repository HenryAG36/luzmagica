import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    createPaymentLink,
    extractTransaction,
    verifyEventChecksum,
    type WompiEventBody,
} from "../lib/payments/wompi.ts";

const SECRET = "events_secret_test_value";

function signedEvent(overrides: Partial<{
    transactionId: string;
    status: string;
    amountInCents: number;
    paymentLinkId: string | null;
    timestamp: number;
}> = {}): WompiEventBody {
    const tx = {
        id: overrides.transactionId ?? "tx_123",
        status: overrides.status ?? "APPROVED",
        amount_in_cents: overrides.amountInCents ?? 6500000,
        payment_link_id: overrides.paymentLinkId === undefined ? "pl_abc" : overrides.paymentLinkId,
        currency: "COP",
    };
    const timestamp = overrides.timestamp ?? 1710000000;
    const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
    const checksum = createHash("sha256")
        .update(`${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}${SECRET}`, "utf8")
        .digest("hex");
    return {
        event: "transaction.updated",
        data: { transaction: tx },
        signature: { properties, checksum },
        timestamp,
        sent_at: new Date(timestamp * 1000).toISOString(),
    };
}

test("verifyEventChecksum accepts a correctly signed event", () => {
    assert.equal(verifyEventChecksum(signedEvent(), SECRET), true);
});

test("verifyEventChecksum rejects tampering and wrong secrets", () => {
    const tampered = signedEvent();
    (tampered.data as { transaction: { status: string } }).transaction.status = "DECLINED";
    assert.equal(verifyEventChecksum(tampered, SECRET), false);

    assert.equal(verifyEventChecksum(signedEvent(), "other_secret"), false);

    const noProps = { ...signedEvent(), signature: { checksum: "x" } };
    assert.equal(verifyEventChecksum(noProps, SECRET), false);

    const noTs = { ...signedEvent(), timestamp: undefined };
    assert.equal(verifyEventChecksum(noTs, SECRET), false);
});

test("extractTransaction pulls id/status/amount/link, nulls malformed bodies", () => {
    const tx = extractTransaction(signedEvent({ transactionId: "t-9", status: "DECLINED", paymentLinkId: null }));
    assert.deepEqual(tx, {
        id: "t-9",
        status: "DECLINED",
        amountInCents: 6500000,
        paymentLinkId: null,
    });
    assert.equal(extractTransaction({ event: "transaction.updated", data: {} }), null);
    assert.equal(extractTransaction({}), null);
});

test("createPaymentLink uses the sandbox endpoint by default and parses the response", async () => {
    process.env.WOMPI_PRIVATE_KEY = "priv_test_key";
    process.env.WOMPI_EVENTS_SECRET = SECRET;
    delete process.env.WOMPI_ENVIRONMENT;
    try {
        let calledUrl = "";
        let calledBody = "";
        const res = await createPaymentLink(
            { name: "Pedido LM-1", description: "x", amountInCents: 6500000, redirectUrl: "https://shop.test/ok" },
            async (url, init) => {
                calledUrl = String(url);
                calledBody = String(init?.body);
                return new Response(JSON.stringify({ data: { id: "pl_1", url: "https://checkout.wompi.co/l/pl_1" } }), { status: 200 });
            },
        );
        assert.ok(res.ok);
        if (res.ok) {
            assert.equal(res.link.id, "pl_1");
            assert.equal(res.link.url, "https://checkout.wompi.co/l/pl_1");
        }
        assert.match(calledUrl, /^https:\/\/sandbox\.wompi\.co\/v1\/payment_links$/);
        const sent = JSON.parse(calledBody) as Record<string, unknown>;
        assert.equal(sent.amount_in_cents, 6500000);
        assert.equal(sent.currency, "COP");
        assert.equal(sent.single_use, true);
    } finally {
        delete process.env.WOMPI_PRIVATE_KEY;
        delete process.env.WOMPI_EVENTS_SECRET;
    }
});

test("createPaymentLink requires production flag for live endpoint and reports API errors", async () => {
    process.env.WOMPI_PRIVATE_KEY = "priv_live_key";
    process.env.WOMPI_EVENTS_SECRET = SECRET;
    delete process.env.WOMPI_ENVIRONMENT;
    try {
        let calledUrl = "";
        await createPaymentLink(
            { name: "x", description: "x", amountInCents: 1, redirectUrl: "https://shop.test" },
            async (url) => {
                calledUrl = String(url);
                return new Response("{}", { status: 200 });
            },
        );
        assert.match(calledUrl, /sandbox\.wompi\.co/);

        process.env.WOMPI_ENVIRONMENT = "production";
        await createPaymentLink(
            { name: "x", description: "x", amountInCents: 1, redirectUrl: "https://shop.test" },
            async (url) => {
                calledUrl = String(url);
                return new Response("{}", { status: 200 });
            },
        );
        assert.match(calledUrl, /production\.wompi\.co/);

        const failed = await createPaymentLink(
            { name: "x", description: "x", amountInCents: 1, redirectUrl: "https://shop.test" },
            async () => new Response(JSON.stringify({ error: { reason: "Monto inválido" } }), { status: 422 }),
        );
        assert.equal(failed.ok, false);
        if (!failed.ok) assert.match(failed.error, /Monto inválido/);
    } finally {
        delete process.env.WOMPI_PRIVATE_KEY;
        delete process.env.WOMPI_EVENTS_SECRET;
        delete process.env.WOMPI_ENVIRONMENT;
    }
});

test("createPaymentLink fails closed without credentials", async () => {
    delete process.env.WOMPI_PRIVATE_KEY;
    delete process.env.WOMPI_EVENTS_SECRET;
    const res = await createPaymentLink(
        { name: "x", description: "x", amountInCents: 1, redirectUrl: "https://shop.test" },
        async () => new Response("{}", { status: 200 }),
    );
    assert.equal(res.ok, false);
});
