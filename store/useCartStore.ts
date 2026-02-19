"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Product, CartItem } from "@/lib/types";

interface CartState {
    items: CartItem[];
    addItem: (product: Product) => void;
    removeItem: (id: string) => void;
    updateQuantity: (id: string, quantity: number) => void;
    clearCart: () => void;
    getTotalItems: () => number;
    getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],

            addItem: (product: Product) => {
                const items = get().items;
                const existing = items.find((item) => item.product.id === product.id);

                if (existing) {
                    set({
                        items: items.map((item) =>
                            item.product.id === product.id
                                ? { ...item, quantity: item.quantity + 1 }
                                : item
                        ),
                    });
                } else {
                    set({ items: [...items, { product, quantity: 1 }] });
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

            clearCart: () => set({ items: [] }),

            getTotalItems: () =>
                get().items.reduce((sum, item) => sum + item.quantity, 0),

            getTotalPrice: () =>
                get().items.reduce(
                    (sum, item) => sum + item.product.price * item.quantity,
                    0
                ),
        }),
        {
            name: "luzmagica-cart",
        }
    )
);
