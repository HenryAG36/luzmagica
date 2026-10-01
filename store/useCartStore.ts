"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Product, CartItem, CustomerProfile } from "@/lib/types";

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
    getFreeShippingProgress: () => { current: number; threshold: number; remaining: number; percent: number; isFree: boolean };

    // Recovery export/import
    serializeForRecovery: () => string;
    restoreFromRecovery: (encoded: string) => boolean;
}

const FREE_SHIPPING_THRESHOLD = 150000;
const SHIPPING_COST = 15000;
const POINT_VALUE_COP = 10; // 1 point = $10 COP

const DEFAULT_PROFILE: CustomerProfile = {
    name: "Carolina Mejia",
    email: "carolina.mejia@gmail.com",
    phone: "3104567890",
    address: "Calle 127 #15-32 Apto 402",
    city: "Bogotá",
    department: "Cundinamarca",
    cedula: "1018459203",
    notes: "Dejar en portería con vigilancia",
};

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            couponCode: null,
            discountPercent: 0,
            pointsRedeemed: 0,
            customerProfile: DEFAULT_PROFILE,
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

            getShippingFee: () => {
                const subtotal = get().getSubtotal();
                if (subtotal === 0) return 0;
                if (get().couponCode === "ENVIOGRATIS") return 0;
                return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
            },

            getTotalPrice: () => {
                const subtotal = get().getSubtotal();
                if (subtotal === 0) return 0;
                const discount = get().getTotalDiscountCOP();
                const shipping = get().getShippingFee();
                return Math.max(0, subtotal - discount + shipping);
            },

            getFreeShippingProgress: () => {
                const current = get().getSubtotal();
                const threshold = FREE_SHIPPING_THRESHOLD;
                const remaining = Math.max(0, threshold - current);
                const percent = Math.min(100, Math.round((current / threshold) * 100));
                return {
                    current,
                    threshold,
                    remaining,
                    percent,
                    isFree: current >= threshold || get().couponCode === "ENVIOGRATIS",
                };
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
                    if (parsed.coupon) {
                        get().applyCoupon(parsed.coupon);
                    }
                    if (parsed.profile) {
                        get().setCustomerProfile(parsed.profile);
                    }
                    return true;
                } catch {
                    return false;
                }
            },
        }),
        {
            name: "luzmagica-cart-v2",
        }
    )
);
