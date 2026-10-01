"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Order, OrderStatus, TrackingEvent, CartItem, CustomerProfile } from "@/lib/types";

interface OrderState {
    orders: Order[];
    createOrder: (data: {
        customer: CustomerProfile;
        items: CartItem[];
        subtotal: number;
        discountAmount: number;
        shippingFee: number;
        total: number;
        paymentMethod: Order["paymentMethod"];
        loyaltyPointsEarned: number;
        loyaltyPointsUsed: number;
        isReorder?: boolean;
        recoveredFromCartId?: string;
    }) => Order;
    getOrderById: (id: string) => Order | undefined;
    updateOrderStatus: (
        orderId: string,
        status: OrderStatus,
        trackingNumber?: string,
        carrier?: Order["carrier"],
        customNote?: string
    ) => void;
    submitReview: (orderId: string, rating: number, comment: string) => void;
    getOrdersByCustomerPhone: (phone: string) => Order[];
    getRecentReorderItems: () => CartItem[];
}

function buildTrackingEvents(status: OrderStatus, carrier = "Coordinadora", trackingNo = "CO-883921"): TrackingEvent[] {
    const now = new Date();
    const d = (daysAgo: number) => {
        const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        return date.toISOString().replace("T", " ").substring(0, 16);
    };

    const allEvents: TrackingEvent[] = [
        {
            status: "payment_confirmed",
            label: "Pago Confirmado",
            description: "Tu pago ha sido verificado con éxito y la orden ingresó al sistema de preparación.",
            timestamp: d(6),
            location: "Bogotá, Colombia",
            completed: true,
        },
        {
            status: "supplier_processing",
            label: "Preparación en Bodega",
            description: "Tu pedido fue empaquetado, verificado por control de calidad e inspeccionado.",
            timestamp: d(5),
            location: "Centro de Despacho",
            completed: ["supplier_processing", "international_transit", "customs_cleared", "local_delivery", "delivered"].includes(status),
        },
        {
            status: "international_transit",
            label: "Vuelo de Tránsito & Arribo",
            description: "Embarque aéreo internacional despachado con destino a Colombia.",
            timestamp: d(3),
            location: "Terminal de Carga Aérea",
            completed: ["international_transit", "customs_cleared", "local_delivery", "delivered"].includes(status),
        },
        {
            status: "customs_cleared",
            label: "Nacionalización DIAN & Aduana",
            description: "Inspección aduanera superada con éxito. Documentación de importación aprobada.",
            timestamp: d(2),
            location: "Aduana Aeropuerto El Dorado, Bogotá",
            completed: ["customs_cleared", "local_delivery", "delivered"].includes(status),
        },
        {
            status: "local_delivery",
            label: `En Reparto con ${carrier}`,
            description: `Paquete entregado a ${carrier} con número de guía oficial ${trackingNo}. En ruta final.`,
            timestamp: d(1),
            location: "Centro de Distribución Local",
            completed: ["local_delivery", "delivered"].includes(status),
        },
        {
            status: "delivered",
            label: "¡Entregado a Satisfacción!",
            description: "Paquete entregado al destinatario en la dirección registrada.",
            timestamp: d(0),
            location: "Dirección de Entrega",
            completed: status === "delivered",
        },
    ];

    return allEvents;
}

const SEEDED_ORDERS: Order[] = [
    {
        id: "LM-8921",
        date: "2026-09-22 14:32",
        customer: {
            name: "Carolina Mejia",
            email: "carolina.mejia@gmail.com",
            phone: "3104567890",
            address: "Calle 127 #15-32 Apto 402",
            city: "Bogotá",
            department: "Cundinamarca",
            cedula: "1018459203",
            notes: "Dejar en portería",
        },
        items: [
            {
                product: {
                    id: "1",
                    name: "Proyector de Nebulosa Estrellas",
                    price: 89900,
                    originalPrice: 129900,
                    category: "proyectores",
                    room: "dormitorio",
                    images: ["/images/products/nebula-1.jpg"],
                    badge: "sale",
                    description: "Transforma tu habitación en un cielo estrellado con 16 colores y control remoto.",
                    stock: 24,
                    type: "proyector",
                    supplierCostCOP: 38000,
                },
                quantity: 1,
            },
        ],
        subtotal: 89900,
        discountAmount: 0,
        shippingFee: 15000,
        total: 104900,
        supplierCostTotal: 38000,
        paymentMethod: "nequi",
        status: "delivered",
        trackingNumber: "CO-91823901",
        carrier: "Coordinadora",
        trackingEvents: buildTrackingEvents("delivered", "Coordinadora", "CO-91823901"),
        loyaltyPointsEarned: 89,
        loyaltyPointsUsed: 0,
        review: {
            rating: 5,
            comment: "¡Increíble la calidad del proyector! Mi cuarto parece una galaxia real. Llegó en perfecto estado.",
            date: "2026-09-27",
        },
    },
    {
        id: "LM-9402",
        date: "2026-09-29 18:15",
        customer: {
            name: "Mateo Gómez",
            email: "mateo.gomez@hotmail.com",
            phone: "3007891234",
            address: "Carrera 43A #1-50 Interior 8",
            city: "Medellín",
            department: "Antioquia",
            cedula: "1037648291",
            notes: "Timbre 801",
        },
        items: [
            {
                product: {
                    id: "4",
                    name: "Panel LED Hexagonal para Pared",
                    price: 110000,
                    originalPrice: 145000,
                    category: "paneles",
                    room: "gaming",
                    images: ["/images/products/hex-panel-1.jpg"],
                    badge: "sale",
                    description: "Set de 6 paneles LED hexagonales modulares reactivos al sonido.",
                    stock: 12,
                    type: "panel",
                    supplierCostCOP: 48000,
                },
                quantity: 1,
            },
            {
                product: {
                    id: "2",
                    name: "Tira LED RGB 5m para TV",
                    price: 45000,
                    originalPrice: 65000,
                    category: "tiras-led",
                    room: "sala",
                    images: ["/images/products/led-strip-1.jpg"],
                    badge: "sale",
                    description: "Tira LED RGB de 5 metros con control por app y sincronización musical.",
                    stock: 56,
                    type: "tira-led",
                    supplierCostCOP: 19000,
                },
                quantity: 1,
            },
        ],
        subtotal: 155000,
        discountAmount: 15500, // 10% coupon MAGIA10
        shippingFee: 0, // Free shipping threshold met
        total: 139500,
        supplierCostTotal: 67000,
        paymentMethod: "pse",
        status: "local_delivery",
        trackingNumber: "SV-4820199",
        carrier: "Servientrega",
        trackingEvents: buildTrackingEvents("local_delivery", "Servientrega", "SV-4820199"),
        loyaltyPointsEarned: 139,
        loyaltyPointsUsed: 0,
        isReorder: true,
    },
    {
        id: "LM-9811",
        date: "2026-10-01 11:20",
        customer: {
            name: "Valentina Ríos",
            email: "valen.rios@gmail.com",
            phone: "3189901122",
            address: "Av. Santander #54-10",
            city: "Manizales",
            department: "Caldas",
            cedula: "1053820194",
        },
        items: [
            {
                product: {
                    id: "3",
                    name: "Lámpara Luna 3D",
                    price: 72000,
                    originalPrice: null,
                    category: "lamparas",
                    room: "dormitorio",
                    images: ["/images/products/moon-lamp-1.jpg"],
                    badge: "new",
                    description: "Réplica de la luna impresa en 3D con 16 colores y base de madera.",
                    stock: 18,
                    type: "lampara",
                    supplierCostCOP: 28000,
                },
                quantity: 1,
            },
        ],
        subtotal: 72000,
        discountAmount: 0,
        shippingFee: 15000,
        total: 87000,
        supplierCostTotal: 28000,
        paymentMethod: "bancolombia",
        status: "payment_confirmed",
        trackingNumber: "PENDIENTE",
        carrier: "Coordinadora",
        trackingEvents: buildTrackingEvents("payment_confirmed", "Coordinadora", "PENDIENTE"),
        loyaltyPointsEarned: 87,
        loyaltyPointsUsed: 0,
    },
];

export const useOrderStore = create<OrderState>()(
    persist(
        (set, get) => ({
            orders: SEEDED_ORDERS,

            createOrder: (data) => {
                const orderNum = Math.floor(1000 + Math.random() * 9000);
                const orderId = `LM-${orderNum}`;
                const now = new Date();
                const dateStr = now.toISOString().replace("T", " ").substring(0, 16);

                const supplierCostTotal = data.items.reduce(
                    (sum, item) => sum + (item.product.supplierCostCOP || item.product.price * 0.42) * item.quantity,
                    0
                );

                const newOrder: Order = {
                    id: orderId,
                    date: dateStr,
                    customer: data.customer,
                    items: data.items,
                    subtotal: data.subtotal,
                    discountAmount: data.discountAmount,
                    shippingFee: data.shippingFee,
                    total: data.total,
                    supplierCostTotal: Math.round(supplierCostTotal),
                    paymentMethod: data.paymentMethod,
                    status: "payment_confirmed",
                    trackingNumber: `CO-${Math.floor(10000000 + Math.random() * 90000000)}`,
                    carrier: "Coordinadora",
                    trackingEvents: buildTrackingEvents("payment_confirmed", "Coordinadora"),
                    loyaltyPointsEarned: data.loyaltyPointsEarned,
                    loyaltyPointsUsed: data.loyaltyPointsUsed,
                    isReorder: data.isReorder,
                    recoveredFromCartId: data.recoveredFromCartId,
                };

                set({ orders: [newOrder, ...get().orders] });
                return newOrder;
            },

            getOrderById: (id: string) => {
                const clean = id.trim().toUpperCase();
                return get().orders.find((o) => o.id === clean || o.trackingNumber === clean);
            },

            updateOrderStatus: (orderId, status, trackingNumber, carrier = "Coordinadora") => {
                const target = get().getOrderById(orderId);
                if (!target) return;

                const tNo = trackingNumber || target.trackingNumber;
                const events = buildTrackingEvents(status, carrier, tNo);

                set({
                    orders: get().orders.map((o) =>
                        o.id === target.id
                            ? {
                                  ...o,
                                  status,
                                  carrier,
                                  trackingNumber: tNo,
                                  trackingEvents: events,
                              }
                            : o
                    ),
                });
            },

            submitReview: (orderId, rating, comment) => {
                const today = new Date().toISOString().split("T")[0];
                set({
                    orders: get().orders.map((o) =>
                        o.id === orderId
                            ? {
                                  ...o,
                                  review: { rating, comment, date: today },
                              }
                            : o
                    ),
                });
            },

            getOrdersByCustomerPhone: (phone: string) => {
                const clean = phone.replace(/\D/g, "");
                return get().orders.filter((o) => o.customer.phone.replace(/\D/g, "").includes(clean));
            },

            getRecentReorderItems: () => {
                const orders = get().orders;
                if (orders.length === 0) return [];
                // Collect distinct items from last 3 orders
                const itemMap = new Map<string, CartItem>();
                for (const order of orders.slice(0, 3)) {
                    for (const item of order.items) {
                        if (!itemMap.has(item.product.id)) {
                            itemMap.set(item.product.id, item);
                        }
                    }
                }
                return Array.from(itemMap.values());
            },
        }),
        {
            name: "luzmagica-orders-v1",
        }
    )
);
