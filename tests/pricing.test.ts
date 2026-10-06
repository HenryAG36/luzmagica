import { test } from "node:test";
import assert from "node:assert/strict";
import { computeActualContribution, computePriceSuggestion, resolveUsdAmount, usdToCop } from "../lib/catalog/pricing.ts";

test("pricing suggestion matches the authored example with unknown fees", () => {
    const s = computePriceSuggestion({
        supplierCostCop: 20000,
        shippingCop: 5000,
        taxesFeesCop: null,
        paymentFeePercent: null,
        targetMarginPercent: 15,
    });
    assert.ok(s);
    assert.equal(s.total, 29412);
    assert.equal(s.customerProduct, 24412);
    assert.equal(s.customerShipping, 5000);
    assert.equal(s.contributionCop, 4412);
    assert.equal(s.provisional, true);
});

test("pricing suggestion matches the authored example with known fees", () => {
    const s = computePriceSuggestion({
        supplierCostCop: 20000,
        shippingCop: 5000,
        taxesFeesCop: 0,
        paymentFeePercent: 3,
        targetMarginPercent: 15,
    });
    assert.ok(s);
    assert.equal(s.total, 30488);
    assert.equal(s.customerProduct, 25488);
    assert.equal(s.customerShipping, 5000);
    assert.equal(s.contributionCop, 4573.36);
    assert.equal(s.provisional, false);
});

test("pricing rejects invalid or out-of-range inputs", () => {
    const base = { supplierCostCop: 20000, shippingCop: 5000 };
    assert.equal(computePriceSuggestion({ ...base, targetMarginPercent: 14 }), null);
    assert.equal(computePriceSuggestion({ ...base, targetMarginPercent: 51 }), null);
    assert.equal(computePriceSuggestion({ ...base, targetMarginPercent: 15.5 }), null);
    assert.equal(computePriceSuggestion({ ...base, supplierCostCop: -1 }), null);
    assert.equal(computePriceSuggestion({ ...base, supplierCostCop: 1.5 }), null);
    assert.equal(computePriceSuggestion({ ...base, shippingCop: Number.NaN }), null);
    assert.equal(computePriceSuggestion({ ...base, taxesFeesCop: -5 }), null);
    assert.equal(computePriceSuggestion({ ...base, paymentFeePercent: 21 }), null);
    assert.equal(computePriceSuggestion({ ...base, paymentFeePercent: -1 }), null);
    assert.equal(computePriceSuggestion({ ...base, paymentFeePercent: 95 }), null);
    assert.equal(
        computePriceSuggestion({ ...base, taxesFeesCop: 0, paymentFeePercent: 85, targetMarginPercent: 15 }),
        null
    );
    assert.equal(
        computePriceSuggestion({ supplierCostCop: 2147483647, shippingCop: 0, targetMarginPercent: 15 }),
        null
    );
    assert.equal(
        computePriceSuggestion({ supplierCostCop: 10, shippingCop: 10, targetMarginPercent: 15, paymentFeePercent: 86 }),
        null
    );
});

test("pricing defaults target margin to 15", () => {
    const s = computePriceSuggestion({ supplierCostCop: 20000, shippingCop: 5000 });
    assert.ok(s);
    assert.equal(s.total, 29412);
});

test("usd to cop conversion requires a positive finite rate", () => {
    assert.equal(usdToCop(1.99, 4200), 8358);
    assert.equal(usdToCop(0, 4200), 0);
    assert.equal(usdToCop(1.99, 0), null);
    assert.equal(usdToCop(1.99, -5), null);
    assert.equal(usdToCop(1.99, Number.NaN), null);
    assert.equal(usdToCop(1.99, "4200"), null);
    assert.equal(usdToCop(-1, 4200), null);
    assert.equal(usdToCop(1e12, 4200), null);
});

test("actual contribution is product price minus supplier cost only", () => {
    assert.equal(computeActualContribution(24412, 20000), 4412);
    assert.equal(computeActualContribution(100, 150), -50);
    assert.equal(computeActualContribution(24412, null), null);
    assert.equal(computeActualContribution(-1, 20000), null);
    assert.equal(computeActualContribution("24412", 20000), null);
});

test("usd amount resolves only for USD sku or USD product fallback", () => {
    assert.equal(resolveUsdAmount(12.3, "USD"), 12.3);
    assert.equal(resolveUsdAmount(12.3, null, "USD"), 12.3);
    assert.equal(resolveUsdAmount(12.3, "EUR"), null);
    assert.equal(resolveUsdAmount(12.3, "EUR", "USD"), null);
    assert.equal(resolveUsdAmount(12.3, null), null);
    assert.equal(resolveUsdAmount(null, "USD"), null);
});

test("pricing field parsers: empty is unset, invalid is null, zero is explicit", async () => {
    const { parseCopInput, parsePercentInput } = await import("../lib/catalog/pricing.ts");
    assert.equal(parseCopInput(""), null);
    assert.equal(parseCopInput("   "), null);
    assert.equal(parseCopInput("0"), 0);
    assert.equal(parseCopInput("5000"), 5000);
    assert.equal(parseCopInput("-1"), null);
    assert.equal(parseCopInput("1.5"), null);
    assert.equal(parseCopInput("abc"), null);
    assert.equal(parseCopInput("9999999999999"), null);
    assert.equal(parsePercentInput(""), null);
    assert.equal(parsePercentInput("2.5"), 2.5);
    assert.equal(parsePercentInput("x"), null);
});
