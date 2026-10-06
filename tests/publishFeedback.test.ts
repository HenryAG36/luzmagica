import { test } from "node:test";
import assert from "node:assert/strict";
import { describePublishError } from "../lib/catalog/publishFeedback.ts";

test("missing fields are translated to Spanish labels", () => {
    const msg = describePublishError({ missing: ["price_cop", "supplier_rights_confirmed"] });
    assert.equal(
        msg,
        "Faltan campos para publicar: precio de venta, confirmación de derechos del proveedor."
    );
});

test("unknown missing keys are sanitized and bounded", () => {
    const msg = describePublishError({ missing: ["custom<field>", "a".repeat(200)] });
    assert.ok(msg.startsWith("Faltan campos para publicar: "));
    assert.equal(msg.includes("<"), false);
    assert.ok(msg.length < 120);
});

test("malformed payloads never throw and fall back", () => {
    assert.equal(describePublishError(null), "No se pudo publicar.");
    assert.equal(describePublishError("nope"), "No se pudo publicar.");
    assert.equal(describePublishError(42), "No se pudo publicar.");
    assert.equal(describePublishError({ missing: "not-array" }), "No se pudo publicar.");
    assert.equal(describePublishError({ missing: [] }), "No se pudo publicar.");
    assert.equal(describePublishError({ missing: [123, null] }), "No se pudo publicar.");
    assert.equal(describePublishError({}), "No se pudo publicar.");
});

test("server error string is surfaced and bounded", () => {
    assert.equal(describePublishError({ error: "draft not found" }), "draft not found");
    const long = describePublishError({ error: "x".repeat(1000) });
    assert.ok(long.length <= 300);
    assert.equal(describePublishError({ error: 123 }), "No se pudo publicar.");
    assert.equal(describePublishError({ error: "   " }), "No se pudo publicar.");
});
