"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Product, CartItem, CustomerProfile } from "@/lib/types";
import { computeCartTotals, legacyFreeShippingProgress, CartTotals } from "@/lib/cart/totals";
import {
    BLANK_PROFILE,
    SEEDED_PRODUCT_IDS,
    isSeededProfile,
    migrateCartPersisted,
} from "@/store/migrations";

interface CartState {
    items: CartItem[];
    couponCode: string | null;
    discountPercent: number;
    pointsRedeemed: number;
    customerProfile: CustomerProfile;
    appliedRecoveryId: string | null;

    addItem: (product: Product, quantity?: number) => void;
    removeItem: (id: string) => void;
    updateQuantity: (id: string, quantity: number) => void;
    clearCart: () => void;
    applyCoupon: (code: string) => { success: boolean; message: string };
    removeCoupon: () => void;
    setPointsRedeemed: (points: number) => void;
    setCustomerProfile: (profile: Partial<CustomerProfile>) => void;
    setAppliedRecoveryId: (recoveryId: string | null) => void;

    // Computed getters
    getTotalItems: () => number;
    getSubtotal: () => number;
    getCouponDiscountCOP: () => number;
    getPointsDiscountCOP: () => number;
    getTotalDiscountCOP: () => number;
    getShippingFee: () => number;
    getTotalPrice: () => number;
    getShippingBreakdown: () => CartTotals;
    getFreeShippingProgress: () => { current: number; threshold: number; remaining: number; percent: number; isFree: boolean };

    // Recovery export/import
    serializeForRecovery: () => string;
    restoreFromRecovery: (encoded: string) => boolean;
}

const POINT_VALUE_COP = 10; // 1 point = $10 COP

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            couponCode: null,
            discountPercent: 0,
            pointsRedeemed: 0,
            customerProfile: { ...BLANK_PROFILE },
            appliedRecoveryId: null,

            addItem: (product: Product, quantity = 1) => {
                const items = get().items;
                const existing = items.find((item) => item.product.id === product.id);

                if (existing) {
                    set({
                        items: items.map((item) =>
                            item.product.id === product.id
                                ? { ...item, quantity: item.quantity + quantity }
                                : item
                        ),
                    });
                } else {
                    set({ items: [...items, { product, quantity }] });
                }
            },

            removeItem: (id: string) => {
                set({ items: get().items.filter((item) => item.product.id !== id) });
            },

            updateQuantity: (id: string, quantity: number) => {
                if (quantity <= 0) {
                    get().removeItem(id);
                    return;
                }
                set({
                    items: get().items.map((item) =>
                        item.product.id === id ? { ...item, quantity } : item
                    ),
                });
            },

            clearCart: () =>
                set({
                    items: [],
                    couponCode: null,
                    discountPercent: 0,
                    pointsRedeemed: 0,
                    appliedRecoveryId: null,
                }),

            applyCoupon: (code: string) => {
                const clean = code.trim().toUpperCase();
                if (clean === "MAGIA10" || clean === "RETORNO10") {
                    set({ couponCode: clean, discountPercent: 10 });
                    return { success: true, message: "¡Cupón del 10% aplicado exitosamente!" };
                }
                if (clean === "LUZVIP15") {
                    set({ couponCode: clean, discountPercent: 15 });
                    return { success: true, message: "¡Cupón VIP del 15% aplicado exitosamente!" };
                }
                if (clean === "ENVIOGRATIS") {
                    set({ couponCode: clean, discountPercent: 0 });
                    return { success: true, message: "¡Envío gratis nacional aplicado!" };
                }
                return { success: false, message: "Código de descuento no válido o vencido." };
            },

            removeCoupon: () => set({ couponCode: null, discountPercent: 0 }),

            setPointsRedeemed: (points: number) => {
                set({ pointsRedeemed: Math.max(0, points) });
            },

            setCustomerProfile: (profile: Partial<CustomerProfile>) => {
                set({ customerProfile: { ...get().customerProfile, ...profile } });
            },

            setAppliedRecoveryId: (recoveryId: string | null) => {
                set({ appliedRecoveryId: recoveryId });
            },

            getTotalItems: () =>
                get().items.reduce((sum, item) => sum + item.quantity, 0),

            getSubtotal: () =>
                get().items.reduce(
                    (sum, item) => sum + item.product.price * item.quantity,
                    0
                ),

            getCouponDiscountCOP: () => {
                const subtotal = get().getSubtotal();
                return Math.round((subtotal * get().discountPercent) / 100);
            },

            getPointsDiscountCOP: () => {
                return get().pointsRedeemed * POINT_VALUE_COP;
            },

            getTotalDiscountCOP: () => {
                return get().getCouponDiscountCOP() + get().getPointsDiscountCOP();
            },

            getShippingBreakdown: () =>
                computeCartTotals(
                    get().items,
                    get().couponCode,
                    get().discountPercent,
                    get().getPointsDiscountCOP()
                ),

            getShippingFee: () => get().getShippingBreakdown().shippingCop ?? 0,

            getTotalPrice: () => get().getShippingBreakdown().total ?? 0,

            getFreeShippingProgress: () => {
                const progress = legacyFreeShippingProgress(
                    get().getShippingBreakdown().legacySubtotal,
                    get().couponCode
                );
                return { current: progress.threshold - progress.remaining, ...progress };
            },

            serializeForRecovery: () => {
                const data = {
                    items: get().items.map((i) => ({ id: i.product.id, q: i.quantity })),
                    coupon: get().couponCode,
                    profile: get().customerProfile,
                };
                return btoa(JSON.stringify(data));
            },

            restoreFromRecovery: (encoded: string) => {
                try {
                    const parsed = JSON.parse(atob(encoded));
                    // Never resurrect removed seed catalog items from recovery payloads.
                    if (Array.isArray(parsed.items)) {
                        parsed.items = parsed.items.filter(
                            (i: { id?: unknown }) => !SEEDED_PRODUCT_IDS.has(String(i?.id)),
                        );
                    }
                    if (parsed.coupon) {
                        get().applyCoupon(parsed.coupon);
                    }
                    if (parsed.profile) {
                        get().setCustomerProfile(
                            isSeededProfile(parsed.profile)
                                ? { ...BLANK_PROFILE }
                                : parsed.profile,
                        );
                    }
                    return true;
                } catch {
                    return false;
                }
            },
        }),
        {
            name: "luzmagica-cart-v2",
            version: 1,
            migrate: (persisted) => migrateCartPersisted(persisted) as CartState,
        }
    )
);
