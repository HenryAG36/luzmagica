const INT32_MAX = 2147483647;

export interface PriceSuggestionInput {
    supplierCostCop: number;
    shippingCop: number;
    taxesFeesCop?: number | null;
    paymentFeePercent?: number | null;
    targetMarginPercent?: number;
}

export interface PriceSuggestion {
    total: number;
    customerProduct: number;
    customerShipping: number;
    contributionCop: number;
    provisional: boolean;
}

function isSafeNonNegInt(v: unknown): v is number {
    return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

export function usdToCop(usdAmount: unknown, rate: unknown): number | null {
    if (
        typeof usdAmount !== "number" ||
        !Number.isFinite(usdAmount) ||
        usdAmount < 0 ||
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate <= 0
    ) {
        return null;
    }
    const cop = Math.ceil(usdAmount * rate);
    return Number.isSafeInteger(cop) && cop <= INT32_MAX ? cop : null;
}

export function resolveUsdAmount(
    amount: number | null,
    currency: string | null,
    fallbackCurrency?: string | null
): number | null {
    if (amount === null) return null;
    const effective = currency ?? fallbackCurrency ?? null;
    return effective === "USD" ? amount : null;
}

export function computeActualContribution(
    customerProductCop: unknown,
    supplierCostCop: unknown
): number | null {
    if (!isSafeNonNegInt(customerProductCop) || !isSafeNonNegInt(supplierCostCop)) return null;
    return customerProductCop - supplierCostCop;
}

export function parseCopInput(value: string): number | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 && n <= INT32_MAX ? n : null;
}

export function parsePercentInput(value: string): number | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

export function computePriceSuggestion(input: PriceSuggestionInput): PriceSuggestion | null {
    const { supplierCostCop, shippingCop } = input;
    const taxes = input.taxesFeesCop ?? null;
    const payment = input.paymentFeePercent ?? null;
    const target = input.targetMarginPercent ?? 15;

    if (!isSafeNonNegInt(supplierCostCop) || !isSafeNonNegInt(shippingCop)) return null;
    if (taxes !== null && !isSafeNonNegInt(taxes)) return null;
    if (!Number.isInteger(target) || target < 15 || target > 50) return null;
    if (
        payment !== null &&
        (typeof payment !== "number" || !Number.isFinite(payment) || payment < 0 || payment > 20)
    ) {
        return null;
    }

    const denominator = 1 - target / 100 - (payment ?? 0) / 100;
    if (denominator <= 0) return null;

    const total = Math.ceil((supplierCostCop + shippingCop + (taxes ?? 0)) / denominator);
    if (!Number.isSafeInteger(total) || total <= 0 || total > INT32_MAX) return null;

    const contribution =
        total - (supplierCostCop + shippingCop + (taxes ?? 0)) - (total * (payment ?? 0)) / 100;

    return {
        total,
        customerProduct: total - shippingCop,
        customerShipping: shippingCop,
        contributionCop: Math.round(contribution * 100) / 100,
        provisional: taxes === null || payment === null,
    };
}
