"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Order, OrderStatus, TrackingEvent } from "@/lib/types";
import { migrateOrdersPersisted } from "@/store/migrations";

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    payment_confirmed: "Pago confirmado",
    supplier_processing: "Procesando con proveedor",
    international_transit: "Tránsito internacional",
    customs_cleared: "Liberado de aduana",
    local_delivery: "En reparto local",
    delivered: "Entregado",
};

interface OrderState {
    orders: Order[];
    updateOrderStatus: (
        orderId: string,
        status: OrderStatus,
        trackingNumber?: string,
        carrier?: Order["carrier"],
        customNote?: string,
    ) => void;
    submitReview: (orderId: string, rating: number, comment: string) => void;
    getOrderById: (orderId: string) => Order | undefined;
    getOrdersByCustomerPhone: (phone: string) => Order[];
    getRecentReorderItems: () => Array<{ product: Order["items"][number]["product"]; quantity: number }>;
}

export const useOrderStore = create<OrderState>()(
    persist(
        (set, get) => ({
            orders: [],

            updateOrderStatus: (orderId, status, trackingNumber, carrier, customNote) => {
                const target = get().getOrderById(orderId);
                if (!target) return;

                const event: TrackingEvent = {
                    status,
                    label: ORDER_STATUS_LABELS[status],
                    description:
                        customNote?.trim() || "Actualización registrada por el operador.",
                    timestamp: new Date().toISOString(),
                    location: "",
                    completed: true,
                };

                set({
                    orders: get().orders.map((order) =>
                        order.id === target.id
                            ? {
                                  ...order,
                                  status,
                                  trackingNumber: trackingNumber?.trim() || order.trackingNumber,
                                  carrier: carrier ?? order.carrier,
                                  trackingEvents: [...order.trackingEvents, event],
                              }
                            : order,
                    ),
                });
            },

            submitReview: (orderId, rating, comment) => {
                set({
                    orders: get().orders.map((order) =>
                        order.id === orderId
                            ? {
                                  ...order,
                                  review: {
                                      rating,
                                      comment,
                                      date: new Date().toISOString().split("T")[0],
                                  },
                              }
                            : order,
                    ),
                });
            },

            getOrderById: (orderId) => {
                const clean = orderId.trim().toUpperCase();
                return get().orders.find(
                    (o) => o.id === clean || o.trackingNumber === clean,
                );
            },

            getOrdersByCustomerPhone: (phone) => {
                const normalized = phone.replace(/\D/g, "");
                if (!normalized) return [];
                return get().orders.filter((o) =>
                    o.customer.phone.replace(/\D/g, "").includes(normalized),
                );
            },

            getRecentReorderItems: () => {
                const delivered = get()
                    .orders.filter((o) => o.status === "delivered")
                    .sort((a, b) => b.date.localeCompare(a.date));
                const seen = new Set<string>();
                const items: Array<{ product: Order["items"][number]["product"]; quantity: number }> = [];
                for (const order of delivered) {
                    for (const item of order.items) {
                        if (!seen.has(item.product.id)) {
                            seen.add(item.product.id);
                            items.push({ product: item.product, quantity: item.quantity });
                        }
                    }
                }
                return items;
            },
        }),
        {
            name: "luzmagica-orders-v1",
            version: 1,
            migrate: (persisted) => migrateOrdersPersisted(persisted) as OrderState,
        },
    ),
);
