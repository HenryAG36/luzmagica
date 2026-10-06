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

test("feed names extracted only from promos paths, secrets redacted", () => {
    const t = summarizeDiagnosticResponse(
        "aliexpress.ds.feedname.get",
        200,
        {
            code: "0",
            result: {
                promos: {
                    promo: [
                        { promo_name: "DS bestseller" },
                        { promo_name: "app-secret-123-leak" },
                        { promo_name: `${"x".repeat(90)}app-secret-123` },
                        { name: "not-promo-name" },
                        "bare string",
                    ],
                },
                feed_names: ["ignored-not-a-promo"],
            },
        },
        ["app-secret-123"]
    );
    assert.deepEqual(t.shape.feedNames, ["DS bestseller", "[redacted]"]);

    const flatPromos = summarizeDiagnosticResponse("m", 200, {
        code: "0",
        result: { promos: [{ promo_name: "DS hot" }, { promo_name: "DS hot" }] },
    });
    assert.deepEqual(flatPromos.shape.feedNames, ["DS hot"]);

    const respResultPath = summarizeDiagnosticResponse(
        "aliexpress.ds.feedname.get",
        200,
        {
            aliexpress_ds_feedname_get_response: {
                resp_result: {
                    result: { promos: { promo: [{ promo_name: "DS bestseller" }] } },
                },
            },
        }
    );
    assert.deepEqual(respResultPath.shape.feedNames, ["DS bestseller"]);

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
                    JSON.stringify({
                        code: "0",
                        result: { promos: { promo: [{ promo_name: "DS bestseller" }] } },
                    }),
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

test("structure tree: live-evidenced itemids envelope, no raw values", () => {
    const raw = {
        aliexpress_ds_feed_itemids_get_response: {
            result: {
                products: { number: ["1005001234567890", "1005002234567890"] },
                search_id: "s-1",
                total: 42,
            },
            ret: "true",
            rsp_msg: "success",
            resp_result: { resp_code: "200" },
            mystery_field: "hidden",
        },
        request_id: "req-abc",
    };
    const t = summarizeDiagnosticResponse("aliexpress.ds.feed.itemids.get", 200, raw);
    assert.equal(t.ok, true);
    assert.equal(t.shape.productsType, "object");
    assert.equal(t.shape.productCount, null);
    assert.deepEqual(t.codes, { code: null, rspCode: "200", ret: true });

    const s = t.shape.structure;
    assert.equal(s.type, "object");
    const wrapper = s.fields?.aliexpress_ds_feed_itemids_get_response;
    assert.equal(wrapper?.type, "object");
    assert.equal(wrapper?.fields?.result?.type, "object");
    const resultNode = wrapper?.fields?.result;
    assert.equal(resultNode?.fields?.products?.type, "object");
    assert.deepEqual(resultNode?.fields?.products?.fields?.number, {
        type: "array",
        length: 2,
        elementTypes: ["string"],
    });
    assert.equal(resultNode?.fields?.total?.type, "number");
    assert.equal(wrapper?.unknownKeyCount, 1);
    assert.equal(s.unknownKeyCount, 1);
    const serialized = JSON.stringify(t);
    assert.ok(!serialized.includes("1005001234567890"));
    assert.ok(!serialized.includes("mystery_field"));
    assert.ok(!serialized.includes("request_id"));
});

test("structure tree bounded by depth and node cap", () => {
    const deep = { result: { promos: { promo: { promo: { promo: { promo: { promo: "leaf" } } } } } } };
    const t = summarizeDiagnosticResponse("m", 200, deep);
    const serialized = JSON.stringify(t.shape.structure);
    assert.ok(serialized.includes("truncated"));

    const node = (depth: number): Record<string, unknown> =>
        depth === 0
            ? { total: 1 }
            : { result: node(depth - 1), promos: node(depth - 1), products: node(depth - 1) };
    const t2 = summarizeDiagnosticResponse("m", 200, { result: node(4) });
    assert.ok(JSON.stringify(t2.shape.structure).includes("truncated"));
});

test("scalar codes remain sanitized while structure shows types only", () => {
    const t = summarizeDiagnosticResponse("m", 200, {
        code: "0",
        rsp_code: "200",
        ret: true,
        result: { total: "not-a-number", search_id: "secret-id-value" },
    });
    assert.equal(t.shape.structure.fields?.result?.fields?.search_id?.type, "string");
    assert.equal(t.shape.structure.fields?.result?.fields?.total?.type, "string");
    assert.ok(!JSON.stringify(t.shape.structure).includes("secret-id-value"));
});
