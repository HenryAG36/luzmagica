"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AbandonedCart, OperatorTask, CartItem } from "@/lib/types";
import { publicSiteOrigin } from "@/lib/contact";
import { migrateOperatorPersisted } from "@/store/migrations";

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
    generateWhatsAppRecoveryUrl: (cart: AbandonedCart) => string | null;
}

const LAUNCH_CHECKLIST: LaunchItem[] = [
    {
        id: "chk-1",
        title: "Configurar pasarela de pagos",
        description: "Vincular las credenciales de Nequi, PSE y tarjetas antes de habilitar el checkout.",
        completed: false,
        category: "payments",
    },
    {
        id: "chk-2",
        title: "Definir reglas de envío",
        description: "Establecer tarifas, zonas y transportadoras nacionales para el catálogo.",
        completed: false,
        category: "logistics",
    },
    {
        id: "chk-3",
        title: "Revisar programa LuzClub",
        description: "Definir las reglas de acumulación y canje de puntos antes de activarlo.",
        completed: false,
        category: "marketing",
    },
    {
        id: "chk-4",
        title: "Conectar recuperación por WhatsApp",
        description: "Verificar el número de soporte y la plantilla de recuperación de carritos.",
        completed: false,
        category: "marketing",
    },
    {
        id: "chk-5",
        title: "Sincronizar catálogo de proveedores",
        description: "Importar y revisar productos y costos de los proveedores integrados.",
        completed: false,
        category: "logistics",
    },
    {
        id: "chk-6",
        title: "Instalar píxel de anuncios",
        description: "Configurar el seguimiento de conversiones de Meta Ads.",
        completed: false,
        category: "marketing",
    },
];

export const useOperatorStore = create<OperatorState>()(
    persist(
        (set, get) => ({
            abandonedCarts: [],
            tasks: [],
            launchChecklist: LAUNCH_CHECKLIST.map((item) => ({ ...item })),

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
                const rawPhone = cart.customerPhone ? cart.customerPhone.replace(/\D/g, "") : "";
                if (!rawPhone) return null;
                const cleanPhone = rawPhone.startsWith("57") ? rawPhone : `57${rawPhone}`;
                const name = cart.customerName ? cart.customerName.split(" ")[0] : "Hola";
                const itemsList = cart.items
                    .map((i) => `• ${i.product.name} (x${i.quantity})`)
                    .join("\n");
                const checkoutUrl = `${publicSiteOrigin()}/checkout?recover=${encodeURIComponent(cart.id)}`;

                const message = `¡Hola ${name}! Notamos que dejaste productos en tu carrito de LuzMágica:\n\n${itemsList}\n\n👉 Puedes retomar tu orden aquí: ${checkoutUrl}`;

                const url = new URL(`https://wa.me/${cleanPhone}`);
                url.searchParams.set("text", message);
                return url.toString();
            },
        }),
        {
            name: "luzmagica-operator-v1",
            version: 1,
            migrate: (persisted) =>
                migrateOperatorPersisted(persisted, LAUNCH_CHECKLIST) as OperatorState,
        }
    )
);
