// Shared coupon rules — used identically by the browser cart and the
// server-side order pricing, so the charged total can never diverge
// from what the customer saw.
export const FREE_SHIPPING_COUPON = "ENVIOGRATIS";

export interface CouponRule {
    percent: number;
    freeShipping?: boolean;
}

export const COUPONS: Record<string, CouponRule> = {
    MAGIA10: { percent: 10 },
    RETORNO10: { percent: 10 },
    LUZVIP15: { percent: 15 },
    ENVIOGRATIS: { percent: 0, freeShipping: true },
};

export function normalizeCouponCode(code: unknown): string | null {
    if (typeof code !== "string") return null;
    const clean = code.trim().toUpperCase();
    return clean.length > 0 ? clean : null;
}

export function resolveCoupon(code: unknown): { code: string; percent: number } | null {
    const clean = normalizeCouponCode(code);
    if (!clean || !(clean in COUPONS)) return null;
    return { code: clean, percent: COUPONS[clean].percent };
}

export function grantsFreeShipping(code: unknown): boolean {
    const clean = normalizeCouponCode(code);
    return !!clean && COUPONS[clean]?.freeShipping === true;
}
