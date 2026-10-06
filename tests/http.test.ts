import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../lib/trends/http.ts";
import type { FetchLike } from "../lib/trends/http.ts";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

test("fetchJson returns parsed data on success", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse(200, { ok: 1 });
    const res = await fetchJson<{ ok: number }>("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(res.data?.ok, 1);
});

test("fetchJson retries on 429 honoring Retry-After then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        if (calls === 1) return jsonResponse(429, {}, { "retry-after": "0" });
        return jsonResponse(200, { done: true });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
});

test("fetchJson surfaces 429 after bounded retries", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(429, {}, { "retry-after": "0" });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.ok(calls <= 3);
});

test("fetchJson retries transient 5xx then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return calls < 2 ? jsonResponse(503, {}) : jsonResponse(200, { done: 1 });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, true);
});

test("fetchJson fails closed on network errors without unbounded retries", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        throw new Error("boom");
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(res.error, "boom");
    assert.ok(calls <= 3);
});

test("fetchJson propagates non-retryable 4xx without retry", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(404, {});
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.status, 404);
    assert.equal(calls, 1);
});

test("long Retry-After defers instead of retrying", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(429, {}, { "retry-after": "300" });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, false);
    assert.ok(res.deferSeconds! > 200);
    assert.equal(calls, 1);
});

test("HTTP-date Retry-After is parsed and honored", async () => {
    let calls = 0;
    const pastDate = new Date(Date.now() - 1000).toUTCString();
    const fetchImpl: FetchLike = async () => {
        calls++;
        if (calls === 1) return jsonResponse(429, {}, { "retry-after": pastDate });
        return jsonResponse(200, { done: 1 });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
});

test("request deadline bounds total retries", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(503, {});
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl, deadlineMs: Date.now() - 1 });
    assert.equal(res.ok, false);
    assert.equal(res.error, "refresh deadline exceeded");
    assert.equal(calls, 0);
});

test("deadline expiring during retry backoff stops further attempts", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(503, {});
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl, deadlineMs: Date.now() + 100 });
    assert.equal(res.ok, false);
    assert.equal(res.error, "refresh deadline exceeded");
    assert.equal(calls, 1);
});

test("deadline expiring during 429 wait defers rather than retries", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse(429, {}, { "retry-after": "2" });
    };
    const res = await fetchJson("https://x.test", {}, { fetchImpl, deadlineMs: Date.now() + 100 });
    assert.equal(res.ok, false);
    assert.equal(res.error, "refresh deadline exceeded");
    assert.equal(res.deferSeconds, 2);
    assert.equal(calls, 1);
});
