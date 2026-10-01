"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AbandonedCart, OperatorTask, CartItem } from "@/lib/types";

interface LaunchItem {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    category: "payments" | "logistics" | "marketing" | "branding";
}

interface OperatorState {
    abandonedCarts: AbandonedCart[];
    tasks: OperatorTask[];
    launchChecklist: LaunchItem[];

    captureAbandonedCart: (items: CartItem[], total: number, name?: string, phone?: string, email?: string) => AbandonedCart;
    markCartRecovered: (cartId: string) => void;
    markCartContacted: (cartId: string) => void;
    toggleTask: (taskId: string) => void;
    toggleChecklistItem: (itemId: string) => void;
    generateWhatsAppRecoveryUrl: (cart: AbandonedCart) => string;
}

const SEEDED_ABANDONED_CARTS: AbandonedCart[] = [
    {
        id: "AB-3021",
        customerName: "Andrés Restrepo",
        customerPhone: "3154829102",
        customerEmail: "andres.restrepo@outlook.com",
        items: [
            {
                product: {
                    id: "7",
                    name: "Tira LED Neon Flex 3m",
                    price: 95000,
                    originalPrice: null,
                    category: "tiras-led",
                    room: "gaming",
                    images: ["/images/products/neon-flex-1.jpg"],
                    badge: "new",
                    description: "Tira LED tipo neón flexible de 3 metros con 120+ modos.",
                    stock: 20,
                    type: "tira-led",
                    supplierCostCOP: 42000,
                },
                quantity: 1,
            },
        ],
        total: 95000,
        createdAt: "Hoy hace 2 horas",
        recoveryCode: "RETORNO10",
        discountPercent: 10,
        status: "pending",
    },
    {
        id: "AB-2940",
        customerName: "Sofía Castro",
        customerPhone: "3127654321",
        customerEmail: "sofi.castro@gmail.com",
        items: [
            {
                product: {
                    id: "6",
                    name: "Lámpara de Atardecer 360°",
                    price: 68000,
                    originalPrice: 89000,
                    category: "lamparas",
                    room: "sala",
                    images: ["/images/products/sunset-1.jpg"],
                    badge: "sale",
                    description: "Proyector de luz tipo atardecer rotación 360° golden hour.",
                    stock: 31,
                    type: "lampara",
                    supplierCostCOP: 26000,
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
                    description: "Tira LED RGB 5m sincronización musical.",
                    stock: 56,
                    type: "tira-led",
                    supplierCostCOP: 19000,
                },
                quantity: 1,
            },
        ],
        total: 113000,
        createdAt: "Ayer a las 21:40",
        recoveryCode: "RETORNO10",
        discountPercent: 10,
        status: "pending",
    },
];

const SEEDED_TASKS: OperatorTask[] = [
    {
        id: "tsk-1",
        type: "fulfill_order",
        title: "Asignar guía de proveedor a Orden #LM-9811",
        description: "Valentina Ríos pagó con Bancolombia ($87.000 COP). Falta vincular guía de transporte nacional.",
        priority: "high",
        actionLabel: "Gestionar Despacho",
        actionTarget: "LM-9811",
        completed: false,
    },
    {
        id: "tsk-2",
        type: "whatsapp_recovery",
        title: "Recuperar Carrito Abandonado de Andrés Restrepo",
        description: "Dejó Tira LED Neon Flex ($95.000 COP) hace 2h. Enviar WhatsApp con código RETORNO10.",
        priority: "high",
        actionLabel: "Enviar WhatsApp",
        actionTarget: "AB-3021",
        completed: false,
    },
    {
        id: "tsk-3",
        type: "low_stock",
        title: "Alerta Inventario: Panel LED Hexagonal",
        description: "Quedan solo 12 unidades en almacén del proveedor dropshipping. Alto volumen de ventas.",
        priority: "medium",
        actionLabel: "Contactar Proveedor",
        actionTarget: "supplier",
        completed: false,
    },
];

const SEEDED_LAUNCH_ITEMS: LaunchItem[] = [
    {
        id: "chk-1",
        title: "Pasarela de Pagos Nacional (Nequi, PSE, Tarjetas)",
        description: "Configurar llaves de API para cobros inmediatos y transferencias seguras.",
        completed: true,
        category: "payments",
    },
    {
        id: "chk-2",
        title: "Reglas de Envío Gratis y Transportadoras Locales",
        description: "Establecer umbral de envío gratis en $150.000 COP y tarifas de Servientrega/Coordinadora.",
        completed: true,
        category: "logistics",
    },
    {
        id: "chk-3",
        title: "LuzPoints Loyalty Engine Activado",
        description: "Acumulación de 1 pt por cada $1.000 COP y canje directo en checkout habilitado.",
        completed: true,
        category: "marketing",
    },
    {
        id: "chk-4",
        title: "Recuperación de Carritos Exit-Intent por WhatsApp",
        description: "Disparador de descuento automático del 10% cuando el cliente intenta abandonar.",
        completed: true,
        category: "marketing",
    },
    {
        id: "chk-5",
        title: "Sincronización de Catálogo Dropshipping & Costos Unitarios",
        description: "Costos de proveedor asignados para cálculo de margen bruto real por producto.",
        completed: true,
        category: "logistics",
    },
    {
        id: "chk-6",
        title: "Pixel de Meta & TikTok Ads para Remarketing Retentivo",
        description: "Eventos de PageView, AddToCart, InitiateCheckout y Purchase sincronizados.",
        completed: false,
        category: "marketing",
    },
];

export const useOperatorStore = create<OperatorState>()(
    persist(
        (set, get) => ({
            abandonedCarts: SEEDED_ABANDONED_CARTS,
            tasks: SEEDED_TASKS,
            launchChecklist: SEEDED_LAUNCH_ITEMS,

            captureAbandonedCart: (items, total, name, phone, email) => {
                const id = `AB-${Math.floor(1000 + Math.random() * 9000)}`;
                const newCart: AbandonedCart = {
                    id,
                    customerName: name || "Cliente Interesado",
                    customerPhone: phone,
                    customerEmail: email,
                    items,
                    total,
                    createdAt: "Hace unos minutos",
                    recoveryCode: "RETORNO10",
                    discountPercent: 10,
                    status: "pending",
                };

                set({ abandonedCarts: [newCart, ...get().abandonedCarts] });
                return newCart;
            },

            markCartRecovered: (cartId: string) => {
                set({
                    abandonedCarts: get().abandonedCarts.map((c) =>
                        c.id === cartId ? { ...c, status: "recovered" } : c
                    ),
                });
            },

            markCartContacted: (cartId: string) => {
                const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                set({
                    abandonedCarts: get().abandonedCarts.map((c) =>
                        c.id === cartId ? { ...c, lastContactedAt: `Hoy a las ${now}` } : c
                    ),
                });
            },

            toggleTask: (taskId: string) => {
                set({
                    tasks: get().tasks.map((t) =>
                        t.id === taskId ? { ...t, completed: !t.completed } : t
                    ),
                });
            },

            toggleChecklistItem: (itemId: string) => {
                set({
                    launchChecklist: get().launchChecklist.map((i) =>
                        i.id === itemId ? { ...i, completed: !i.completed } : i
                    ),
                });
            },

            generateWhatsAppRecoveryUrl: (cart: AbandonedCart) => {
                const phone = cart.customerPhone ? cart.customerPhone.replace(/\D/g, "") : "573100000000";
                const cleanPhone = phone.startsWith("57") ? phone : `57${phone}`;
                const name = cart.customerName ? cart.customerName.split(" ")[0] : "Hola";
                const itemsList = cart.items.map((i) => `• ${i.product.name} (x${i.quantity})`).join("%0A");

                const message = `¡Hola ${name}! 💡 Notamos que dejaste estos productos mágicos en tu carrito de LuzMágica:%0A%0A${itemsList}%0A%0AQueremos que estrenes iluminación única: usa el cupón exclusivo *${cart.recoveryCode}* para obtener un *10% de descuento inmediato* y envío prioritario.%0A%0A👉 Finaliza tu orden aquí: https://luzmagica.co/checkout?recover=${cart.id}`;

                return `https://wa.me/${cleanPhone}?text=${message}`;
            },
        }),
        {
            name: "luzmagica-operator-v1",
        }
    )
);
