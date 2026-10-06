import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildAuthorizationUrl,
    generatePkceVerifier,
    normalizeCategories,
    normalizeItemBodies,
    normalizeProductBody,
    normalizeUserProductBody,
    normalizeHighlightEntries,
    normalizeTrendKeywords,
    partitionHighlightIds,
    pkceChallenge,
} from "../lib/trends/providers/mercadolibre.ts";

test("buildAuthorizationUrl includes response_type, client, redirect and PKCE challenge", () => {
    const url = new URL(
        buildAuthorizationUrl({
            clientId: "cid",
            redirectUri: "https://app.test/cb",
            state: "st",
            codeChallenge: "ch",
        })
    );
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "cid");
    assert.equal(url.searchParams.get("redirect_uri"), "https://app.test/cb");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "ch");
});

test("pkceChallenge is base64url sha256 of verifier", () => {
    const verifier = generatePkceVerifier();
    const challenge = pkceChallenge(verifier);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
});

test("normalizeTrendKeywords keeps only valid entries without inventing groups", () => {
    const items = normalizeTrendKeywords([
        { keyword: "luces led", url: "https://listado.mercadolibre.com.co/luces-led" },
        { keyword: 42, url: "bad" },
        "junk",
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].signalType, "search_keyword");
    assert.equal(items[0].source, "mercadolibre");
});

test("normalizeHighlightEntries filters unknown types", () => {
    const entries = normalizeHighlightEntries({
        content: [
            { id: "MCO1", type: "ITEM", position: 1 },
            { id: "MCO2", type: "PRODUCT", position: 2 },
            { id: "MCO3", type: "USER_PRODUCT", position: 3 },
            { id: "MCO4", type: "SOMETHING_ELSE" },
        ],
    });
    assert.equal(entries.length, 3);
    const grouped = partitionHighlightIds(entries);
    assert.deepEqual(grouped.ITEM, ["MCO1"]);
    assert.deepEqual(grouped.PRODUCT, ["MCO2"]);
    assert.deepEqual(grouped.USER_PRODUCT, ["MCO3"]);
});

test("normalizeProductBody and normalizeUserProductBody map resource-specific fields", () => {
    const product = normalizeProductBody(
        { id: "MCOP1", name: "Catalog product", pictures: [{ url: "https://img/p.jpg" }], domain_id: "MCO-LAMPS" },
        2
    );
    assert.equal(product?.title, "Catalog product");
    assert.equal(product?.image, "https://img/p.jpg");
    assert.equal(product?.rank, 2);
    assert.equal(product?.price, null);

    const userProduct = normalizeUserProductBody(
        { id: "MCBU1", name: "Seller product", thumbnail: "https://img/u.jpg" },
        null
    );
    assert.equal(userProduct?.title, "Seller product");
    assert.equal(normalizeUserProductBody({ noId: true }, null), null);
});

test("normalizeItemBodies preserves rank and never invents sales", () => {
    const rank = new Map([["MCO1", 1]]);
    const items = normalizeItemBodies(
        [
            { body: { id: "MCO1", title: "Luz", price: 50000, currency_id: "COP", permalink: "https://m.co/1" } },
            { body: { id: "MCO2", title: "Otra", price: 10, currency_id: "COP" } },
            { code: 404 },
        ],
        rank
    );
    assert.equal(items.length, 2);
    assert.equal(items[0].rank, 1);
    assert.equal(items[1].rank, null);
    assert.equal(items[1].salesVolume, null);
});

test("normalizeCategories maps id/name", () => {
    assert.deepEqual(normalizeCategories([{ id: "MCO1", name: "Hogar" }]), [
        { id: "MCO1", name: "Hogar" },
    ]);
});
