import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDb } from "./fakeSupabase.ts";
import {
    runDsDiagnostics,
    summarizeDiagnosticResponse,
} from "../lib/suppliers/dsDiagnostics.ts";
import { encryptSecret } from "../lib/crypto.ts";
import type { FetchLike } from "../lib/trends/http.ts";

function dsEnv() {
    process.env.ALIEXPRESS_DS_APP_KEY = "ds-app-key";
    process.env.ALIEXPRESS_DS_APP_SECRET = "ds-app-secret-123";
    process.env.ALIEXPRESS_DS_REDIRECT_URI = "https://example.com/cb";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
}

function clearDsEnv() {
    delete process.env.ALIEXPRESS_DS_APP_KEY;
    delete process.env.ALIEXPRESS_DS_APP_SECRET;
    delete process.env.ALIEXPRESS_DS_REDIRECT_URI;
    delete process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
}

test("summarize wrapped envelope: allowlisted keys, codes, product count", () => {
    const raw = {
        aliexpress_ds_feed_itemids_get_response: {
            code: "0",
            ret: "true",
            rsp_code: "200",
            rsp_msg: "success",
            result: { total: "42", products: ["1", "2"], search_id: "s-1" },
            hacker_field: "evil",
        },
        request_id: "SECRETVALUE",
    };
    const t = summarizeDiagnosticResponse("aliexpress.ds.feed.itemids.get", 200, raw);
    assert.equal(t.ok, true);
    assert.deepEqual(t.shape.rootKeys, ["aliexpress_ds_feed_itemids_get_response"]);
    assert.deepEqual(t.shape.wrapperKeys, ["code", "result", "ret", "rsp_code", "rsp_msg"]);
    assert.deepEqual(t.shape.resultKeys, ["products", "search_id", "total"]);
    assert.equal(t.shape.unknownKeyCount, 2);
    assert.equal(t.shape.productsType, "array");
    assert.equal(t.shape.productCount, 2);
    assert.deepEqual(t.codes, { code: "0", rspCode: "200", ret: true });
    assert.ok(!JSON.stringify(t).includes("hacker_field"));
    assert.ok(!JSON.stringify(t).includes("SECRETVALUE"));
});

test("summarize direct envelope: empty vs missing products", () => {
    const empty = summarizeDiagnosticResponse("aliexpress.ds.feedname.get", 200, {
        code: "0",
        ret: "true",
        rsp_code: "200",
        result: { products: [] },
    });
    assert.equal(empty.shape.productsType, "array");
    assert.equal(empty.shape.productCount, 0);
    assert.equal(empty.ok, true);

    const missing = summarizeDiagnosticResponse("aliexpress.ds.feedname.get", 200, {
        code: "0",
        ret: "true",
        rsp_code: "200",
        result: { total: 1 },
    });
    assert.equal(missing.shape.productsType, "undefined");
    assert.equal(missing.shape.productCount, null);
});

test("codes sanitized, error_response code surfaced, ret strict", () => {
    const err = summarizeDiagnosticResponse("aliexpress.ds.feedname.get", 200, {
        error_response: { code: "IllegalAccess.Token", msg: "Bearer tok_abc123" },
    });
    assert.equal(err.codes.code, "IllegalAccess.Token");
    assert.equal(err.ok, false);
    assert.ok(!JSON.stringify(err).includes("tok_abc123"));

    const weird = summarizeDiagnosticResponse("m", 200, {
        code: { nested: "evil" },
        ret: "yes",
        rsp_code: "200<script>",
        result: {},
    });
    assert.deepEqual(weird.codes, { code: null, rspCode: null, ret: null });
    assert.equal(weird.ok, false);

    const secretCode = summarizeDiagnosticResponse(
        "m",
        200,
        { code: "app-secret-123", result: {} },
        ["app-secret-123"]
    );
    assert.equal(secretCode.codes.code, null);
    assert.equal(secretCode.ok, false);

    const badCode = summarizeDiagnosticResponse("m", 200, { code: "27", result: {} });
    assert.equal(badCode.ok, false);

    const transportFail = summarizeDiagnosticResponse("m", 500, null);
    assert.equal(transportFail.ok, false);
    assert.equal(transportFail.httpStatus, 500);
});

test("feed names extracted only from documented fields, secrets redacted", () => {
    const t = summarizeDiagnosticResponse(
        "aliexpress.ds.feedname.get",
        200,
        {
            code: "0",
            result: {
                feed_names: ["DS bestseller", "app-secret-123-leak", 42],
                feeds: [
                    { feed_name: "DS new arrivals" },
                    { feed_name: "DS bestseller" },
                    { feed_name: `${"x".repeat(90)}app-secret-123` },
                    {},
                ],
            },
        },
        ["app-secret-123"]
    );
    assert.deepEqual(t.shape.feedNames, ["DS bestseller", "[redacted]", "DS new arrivals"]);

    const noFeeds = summarizeDiagnosticResponse("m", 200, { code: "0", result: { other: [] } });
    assert.deepEqual(noFeeds.shape.feedNames, []);
});

test("unconfigured ds diagnostics fails closed", async () => {
    clearDsEnv();
    const db = new FakeDb();
    const res = await runDsDiagnostics(db.asClient());
    assert.deepEqual(res, { error: "aliexpress ds not configured" });
    assert.equal(db.rpcCalls.length, 0);
});

test("diagnostics runs exactly two sequential read-only calls under the lease", async () => {
    dsEnv();
    try {
        const db = new FakeDb();
        const secret = "a".repeat(64);
        db.tables.provider_connections = [
            {
                provider: "aliexpress_ds",
                status: "connected",
                access_token_encrypted: encryptSecret("cached-ds-token", secret),
                refresh_token_encrypted: encryptSecret("rt-1", secret),
                token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
        ];
        const methods: string[] = [];
        const fetchImpl: FetchLike = async (url) => {
            const method = new URL(url).searchParams.get("method") ?? "";
            methods.push(method);
            if (method === "aliexpress.ds.feedname.get") {
                return new Response(
                    JSON.stringify({ code: "0", result: { feed_names: ["DS bestseller"] } }),
                    { status: 200 }
                );
            }
            return new Response(
                JSON.stringify({
                    aliexpress_ds_feed_itemids_get_response: {
                        code: "0",
                        ret: "true",
                        rsp_code: "200",
                        result: { total: "0", products: [] },
                    },
                }),
                { status: 200 }
            );
        };
        const res = await runDsDiagnostics(db.asClient(), fetchImpl);
        assert.ok("report" in res);
        if (!("report" in res)) return;
        assert.deepEqual(methods, [
            "aliexpress.ds.feedname.get",
            "aliexpress.ds.feed.itemids.get",
        ]);
        assert.equal(res.report.tests.length, 2);
        assert.equal(res.report.tests[0].shape.feedNames[0], "DS bestseller");
        assert.equal(res.report.tests[1].shape.productCount, 0);
        assert.equal(res.report.tests[1].ok, true);
        assert.ok(
            db.rpcCalls.some(
                (c) => c.fn === "release_refresh_lease" && c.args.p_source === "aliexpress_ds"
            )
        );
        assert.ok(!JSON.stringify(res).includes("cached-ds-token"));
        assert.ok(!JSON.stringify(res).includes("ds-app-secret-123"));
    } finally {
        clearDsEnv();
    }
});

test("token failure returns the generic credential message", async () => {
    dsEnv();
    try {
        const db = new FakeDb();
        const res = await runDsDiagnostics(db.asClient());
        assert.deepEqual(res, { error: "No se pudieron obtener credenciales para la prueba" });
        assert.ok(
            db.rpcCalls.some(
                (c) => c.fn === "release_refresh_lease" && c.args.p_source === "aliexpress_ds"
            )
        );
    } finally {
        clearDsEnv();
    }
});
