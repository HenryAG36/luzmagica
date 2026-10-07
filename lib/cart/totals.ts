import type { CartItem } from "@/lib/types";
import { grantsFreeShipping } from "./coupons.ts";

export const FREE_SHIPPING_THRESHOLD = 150000;
export const LEGACY_SHIPPING_COST = 15000;

export interface CartTotals {
    subtotal: number;
    discountCop: number;
    legacySubtotal: number;
    legacyShippingCop: number;
    dsShippingCop: number | null;
    dsPending: boolean;
    dsItemCount: number;
    legacyItemCount: number;
    shippingCop: number | null;
    total: number | null;
}

function isDsItem(item: CartItem): boolean {
    if (item.product.shippingQuoteRequired === true) return true;
    const id = item.product.id;
    return (
        typeof id === "string" &&
        (id.startsWith("imp-aliexpress_ds-") || id.startsWith("imp-cjdropshipping-"))
    );
}

function itemShippingUnit(item: CartItem): number | null {
    const estimate = item.product.shippingEstimateCOP;
    if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0) {
        return null;
    }
    return estimate;
}

export function computeCartTotals(
    items: CartItem[],
    couponCode: string | null,
    discountPercent: number,
    pointsCop = 0
): CartTotals {
    const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const couponDiscount = Math.round((subtotal * discountPercent) / 100);
    const discountCop = couponDiscount + pointsCop;

    const dsItems = items.filter(isDsItem);
    const legacyItems = items.filter((item) => !isDsItem(item));
    const legacySubtotal = legacyItems.reduce(
        (sum, item) => sum + item.product.price * item.quantity,
        0
    );

    let legacyShippingCop = 0;
    if (legacySubtotal > 0) {
        if (grantsFreeShipping(couponCode) || legacySubtotal >= FREE_SHIPPING_THRESHOLD) {
            legacyShippingCop = 0;
        } else {
            legacyShippingCop = LEGACY_SHIPPING_COST;
        }
    }

    let dsShippingCop: number | null = 0;
    for (const item of dsItems) {
        const unit = itemShippingUnit(item);
        if (unit === null) {
            dsShippingCop = null;
            break;
        }
        dsShippingCop += unit * item.quantity;
    }

    const dsPending = dsItems.length > 0 && dsShippingCop === null;
    const shippingCop = dsShippingCop === null ? null : legacyShippingCop + dsShippingCop;
    const total =
        shippingCop === null ? null : Math.max(0, subtotal - discountCop + shippingCop);

    return {
        subtotal,
        discountCop,
        legacySubtotal,
        legacyShippingCop,
        dsShippingCop,
        dsPending,
        dsItemCount: dsItems.reduce((sum, item) => sum + item.quantity, 0),
        legacyItemCount: legacyItems.reduce((sum, item) => sum + item.quantity, 0),
        shippingCop,
        total,
    };
}

export function legacyFreeShippingProgress(legacySubtotal: number, couponCode: string | null) {
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - legacySubtotal);
    return {
        threshold: FREE_SHIPPING_THRESHOLD,
        remaining,
        percent: Math.min(100, Math.round((legacySubtotal / FREE_SHIPPING_THRESHOLD) * 100)),
        isFree: legacySubtotal >= FREE_SHIPPING_THRESHOLD || grantsFreeShipping(couponCode),
    };
}
