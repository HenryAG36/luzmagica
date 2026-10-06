import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    signTopParams,
    buildHotProductParams,
    normalizeHotProducts,
} from "../lib/trends/providers/aliexpress.ts";

test("signTopParams produces md5(secret + sorted pairs + secret) uppercase", () => {
    const params = { b: "2", a: "1", c: "3" };
    const secret = "SECRET";
    const expected = createHash("md5")
        .update("SECRET" + "a1b2c3" + "SECRET", "utf8")
        .digest("hex")
        .toUpperCase();
    assert.equal(signTopParams(params, secret), expected);
});

test("buildHotProductParams includes signature-required fields and CO destination", () => {
    const params = buildHotProductParams({
        appKey: "key1",
        trackingId: "track1",
        timestamp: "2026-10-06 00:00:00",
    });
    assert.equal(params.method, "aliexpress.affiliate.hotproduct.query");
    assert.equal(params.app_key, "key1");
    assert.equal(params.sign_method, "md5");
    assert.equal(params.ship_to_country, "CO");
    assert.equal(params.tracking_id, "track1");
});

test("normalizeHotProducts maps documented response shape", () => {
    const fixture = {
        aliexpress_affiliate_hotproduct_query_response: {
            resp_result: {
                result: {
                    products: {
                        product: [
                            {
                                product_id: 1005001,
                                product_title: "Lamp",
                                product_main_image_url: "https://ae01.example.com/x.jpg",
                                sale_price: "12.50",
                                sale_price_currency: "USD",
                                lastest_volume: "342",
                                product_detail_url: "https://www.aliexpress.com/item/1005001.html",
                                first_level_category_name: "Lights",
                            },
                        ],
                    },
                },
            },
        },
    };
    const items = normalizeHotProducts(fixture);
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceId, "1005001");
    assert.equal(items[0].price, 12.5);
    assert.equal(items[0].currency, "USD");
    assert.equal(items[0].salesVolume, 342);
    assert.equal(items[0].signalType, "hot_product");
});

test("normalizeHotProducts is defensive on malformed responses", () => {
    assert.deepEqual(normalizeHotProducts(null), []);
    assert.deepEqual(normalizeHotProducts({}), []);
    assert.deepEqual(
        normalizeHotProducts({
            aliexpress_affiliate_hotproduct_query_response: {
                resp_result: { result: { products: { product: [{ product_id: "9" }] } } },
            },
        })[0].price,
        null
    );
});
