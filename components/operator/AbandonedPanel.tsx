"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import type { AdminOrderListItem } from "@/lib/orders/repository";
import FadeIn from "@/components/common/FadeIn";

function waUrl(phone: string, message: string): string | null {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) return null;
    const intl = digits.startsWith("57") || digits.length > 10 ? digits : `57${digits}`;
    return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

// Real abandoned checkouts = orders stuck in pending_payment. No browser
// state involved: every card here is a customer who reached the payment step.
export default function AbandonedPanel() {
    const [orders, setOrders] = useState<AdminOrderListItem[] | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setError("");
        try {
            const res = await fetch("/api/admin/orders?status=pending_payment&limit=50");
            if (!res.ok) throw new Error();
            const body = await res.json();
            setOrders(body.orders ?? []);
        } catch {
            setError("No se pudo cargar la lista. Intenta de nuevo.");
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="font-heading text-xl font-bold text-white">
                        Checkouts Abandonados (Pago Pendiente)
                    </h3>
                    <p className="text-xs text-muted">
                        Pedidos reales que quedaron en &ldquo;pago pendiente&rdquo;. Recupéralos por WhatsApp con el cupón RETORNO10.
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white flex items-center gap-1.5"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Actualizar
                </button>
            </div>

            {error && (
                <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                    {error}
                </p>
            )}

            {orders === null && !error ? (
                <div className="text-center py-10 text-muted text-xs animate-pulse">Cargando pedidos pendientes…</div>
            ) : orders !== null && orders.length === 0 ? (
                <div className="text-center py-10 text-muted text-xs">
                    No hay checkouts abandonados ahora mismo.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {orders?.map((order) => {
                        const url = waUrl(
                            order.customer_phone,
                            `Hola ${order.customer_name.split(" ")[0]}, vimos que tu pedido ${order.ref} en LuzMágica quedó pendiente de pago. Si quieres completarlo, te compartimos el cupón RETORNO10 con 10% de descuento.`,
                        );
                        return (
                            <FadeIn key={order.id}>
                                <div className="p-5 rounded-2xl bg-surface-card border border-white/10 flex flex-col justify-between h-full">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-bold text-white text-sm">
                                                {order.customer_name}
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-amber-500/20 text-amber-300">
                                                Pago pendiente
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted mb-3 font-mono">
                                            #{order.ref} • 📱 {order.customer_phone} •{" "}
                                            {new Date(order.created_at).toLocaleString("es-CO")}
                                        </div>
                                        <div className="p-3 rounded-xl bg-surface border border-white/5 space-y-1 mb-4 text-xs">
                                            {order.items.map((i) => (
                                                <div key={i.id} className="flex justify-between text-muted">
                                                    <span className="line-clamp-1 mr-2">
                                                        {i.name} (x{i.quantity})
                                                    </span>
                                                    <span className="text-white font-medium shrink-0">
                                                        {formatCOP(i.unit_price_cop * i.quantity)}
                                                    </span>
                                                </div>
                                            ))}
                                            <div className="pt-2 border-t border-white/10 flex justify-between font-bold text-white text-xs">
                                                <span>Valor Total:</span>
                                                <span className="text-accent">{formatCOP(order.total_cop)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {url && (
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="w-full py-2.5 px-4 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                            <span>Recuperar por WhatsApp</span>
                                        </a>
                                    )}
                                </div>
                            </FadeIn>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
