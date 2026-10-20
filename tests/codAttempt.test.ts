import { test } from "node:test";
import assert from "node:assert/strict";
import { codAttemptId, __resetCodAttemptsForTests } from "../lib/cart/codAttempt.ts";

type StorageStore = Map<string, string>;
const KEY = "honesty-cod-attempt";

function installSessionStorage(store: StorageStore, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
    const sets: string[] = [];
    Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: {
            getItem: (k: string) => {
                if (opts.throwOnGet) throw new Error("denied");
                return store.get(k) ?? null;
            },
            setItem: (k: string, v: string) => {
                if (opts.throwOnSet) throw new Error("denied");
                sets.push(v);
                store.set(k, v);
            },
            removeItem: (k: string) => {
                store.delete(k);
            },
        },
    });
    return sets;
}

const INPUT = {
    customer: {
        name: "Ana Prueba",
        email: "a@b.co",
        phone: "3001234567",
        cedula: "1020",
        address: "Calle 1",
        city: "Bogotá",
        department: "Cundinamarca",
        notes: null,
    },
    items: [{ productId: "ms-1", quantity: 2 }],
};

test("attempt id is stable across retries even when sessionStorage throws", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    installSessionStorage(store, { throwOnGet: true, throwOnSet: true });
    const first = await codAttemptId(INPUT);
    const second = await codAttemptId(INPUT);
    assert.ok("attemptId" in first, JSON.stringify(first));
    assert.ok("attemptId" in second);
    if ("attemptId" in first && "attemptId" in second) assert.equal(first.attemptId, second.attemptId);
    assert.equal(store.size, 0); // nothing persisted — in-memory map kept it stable
});

test("attempt id persists via sessionStorage across module resets", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    installSessionStorage(store);
    const first = await codAttemptId(INPUT);
    __resetCodAttemptsForTests(); // simulates a remount
    const second = await codAttemptId(INPUT);
    if ("attemptId" in first && "attemptId" in second) assert.equal(first.attemptId, second.attemptId);
    assert.ok(store.has(KEY));
});

test("changed cart or customer produces a different attempt id", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    installSessionStorage(store);
    const first = await codAttemptId(INPUT);
    const changed = await codAttemptId({ ...INPUT, items: [{ productId: "ms-1", quantity: 3 }] });
    assert.ok("attemptId" in first && "attemptId" in changed);
    if ("attemptId" in first && "attemptId" in changed) assert.notEqual(first.attemptId, changed.attemptId);
});

test("crypto unavailable fails visibly and never stores plaintext customer data", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    const sets = installSessionStorage(store);
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
        const res = await codAttemptId(INPUT);
        assert.ok("error" in res);
    } finally {
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: realCrypto });
    }
    assert.equal(sets.length, 0);
    for (const v of store.values()) {
        assert.ok(!v.includes("Ana"));
        assert.ok(!v.includes("a@b.co"));
    }
});

test("stored session value contains only fingerprint + uuid, never raw customer fields", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    installSessionStorage(store);
    await codAttemptId(INPUT);
    const stored = store.get(KEY) ?? "";
    assert.ok(stored.length > 0);
    assert.ok(!stored.includes("Ana") && !stored.includes("a@b.co") && !stored.includes("Calle"));
});

test("equivalent email case and phone formats map to the same attempt id", async () => {
    __resetCodAttemptsForTests();
    const store: StorageStore = new Map();
    installSessionStorage(store);
    const base = await codAttemptId(INPUT);
    const emailCase = await codAttemptId({ ...INPUT, customer: { ...INPUT.customer, email: "A@B.CO" } });
    const phoneFmt = await codAttemptId({ ...INPUT, customer: { ...INPUT.customer, phone: "(300) 123-4567" } });
    const phoneSpaced = await codAttemptId({ ...INPUT, customer: { ...INPUT.customer, phone: "300 123 4567" } });
    assert.ok("attemptId" in base && "attemptId" in emailCase && "attemptId" in phoneFmt && "attemptId" in phoneSpaced);
    if ("attemptId" in base && "attemptId" in emailCase && "attemptId" in phoneFmt && "attemptId" in phoneSpaced) {
        assert.equal(base.attemptId, emailCase.attemptId);
        assert.equal(base.attemptId, phoneFmt.attemptId);
        assert.equal(base.attemptId, phoneSpaced.attemptId);
    }
    // A genuinely different phone still mints a new attempt.
    const other = await codAttemptId({ ...INPUT, customer: { ...INPUT.customer, phone: "573001234567" } });
    if ("attemptId" in base && "attemptId" in other) assert.notEqual(base.attemptId, other.attemptId);
});
