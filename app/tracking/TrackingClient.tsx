"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    Search,
    Truck,
    PackageCheck,
    Clock,
    MapPin,
    RotateCcw,
    MessageCircle,
    CheckCircle2,
    Check,
} from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { buildSupportWhatsAppUrl } from "@/lib/contact";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import ReviewForm from "@/components/tracking/ReviewForm";
import type { Product } from "@/lib/types";
import type { FulfillmentStatus, PaymentStatus, PublicOrder } from "@/lib/orders/types";

const PAYMENT_BADGE: Record<PaymentStatus, { label: string; className: string }> = {
    paid: { label: "Pagado", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    pending_payment: { label: "Pago pendiente", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    payment_failed: { label: "Pago no aprobado", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    payment_review: { label: "Pago en revisión", className: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    cancelled: { label: "Cancelado", className: "bg-white/10 text-muted border-white/10" },
    refunded: { label: "Reembolsado", className: "bg-white/10 text-muted border-white/10" },
};

const FULFILLMENT_BADGE: Record<FulfillmentStatus, { label: string; className: string }> = {
    delivered: { label: "Entregado", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    local_delivery: { label: "En Reparto Local", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    customs_cleared: { label: "Nacionalizado DIAN", className: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
    international_transit: { label: "Tránsito Internacional", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    supplier_processing: { label: "Procesando con Proveedor", className: "bg-primary/20 text-primary border-primary/30" },
    payment_confirmed: { label: "Pago Confirmado", className: "bg-primary/20 text-primary border-primary/30" },
    awaiting_payment: { label: "Esperando Pago", className: "bg-white/10 text-muted border-white/10" },
    cancelled: { label: "Cancelado", className: "bg-white/10 text-muted border-white/10" },
};

export default function TrackingClient() {
    const searchParams = useSearchParams();
    const { addItem } = useCartStore();

    const [refInput, setRefInput] = useState(searchParams.get("orderId") ?? "");
    const [contactInput, setContactInput] = useState("");
    const [order, setOrder] = useState<PublicOrder | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [reorderState, setReorderState] = useState<"idle" | "adding" | "added" | "unavailable">("idle");

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!refInput.trim() || !contactInput.trim()) {
            setError("Ingresa la referencia del pedido y tu teléfono o email.");
            return;
        }
        setLoading(true);
        setError("");
        setOrder(null);
        try {
            const res = await fetch("/api/orders/lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ref: refInput.trim(), contact: contactInput.trim() }),
            });
            if (res.ok) {
                const body = await res.json();
                setOrder(body.order as PublicOrder);
            } else {
                setError("No encontramos un pedido con esa referencia y dato de contacto. Verifica ambos e inténtalo de nuevo.");
            }
        } catch {
            setError("Error de red. Verifica tu conexión e intenta de nuevo.");
        } finally {
            setLoading(false);
        }
    };

    // Reorder re-adds items at their CURRENT published price — the snapshot
    // price is never reused, since the supplier price may have changed.
    const handleReorder = async () => {
        if (!order) return;
        setReorderState("adding");
        let added = 0;
        for (const item of order.items) {
            try {
                const res = await fetch(`/api/products/${encodeURIComponent(item.productId)}`);
                if (!res.ok) continue;
                const body = await res.json();
                if (body.product) {
                    addItem(body.product as Product, item.quantity);
                    added += 1;
                }
            } catch {
                // skip item
            }
        }
        setReorderState(added > 0 ? "added" : "unavailable");
        setTimeout(() => setReorderState("idle"), 3000);
    };

    const fulfillment = order ? FULFILLMENT_BADGE[order.fulfillmentStatus] : null;
    const payment = order ? PAYMENT_BADGE[order.paymentStatus] : null;

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-5xl mx-auto">
                <FadeIn>
                    <div className="text-center max-w-2xl mx-auto mb-10">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 inline-block mb-3">
                            Transparencia en Logística & Despacho
                        </span>
                        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-3">
                            Rastreo de <span className="gradient-text">Pedido</span>
                        </h1>
                        <p className="text-xs sm:text-sm text-muted">
                            Consulta el estado registrado de tu pedido con tu referencia y el teléfono o email usado en la compra.
                        </p>
                    </div>

                    <form onSubmit={handleSearch} className="max-w-xl mx-auto mb-10">
                        <div className="p-1.5 rounded-2xl bg-surface border border-white/10 glow-purple space-y-1.5">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={refInput}
                                    onChange={(e) => setRefInput(e.target.value)}
                                    placeholder="Referencia del pedido (ej: LM-482913)"
                                    className="flex-1 px-4 py-2.5 bg-transparent text-sm text-white placeholder-muted focus:outline-none"
                                />
                                <input
                                    type="text"
                                    value={contactInput}
                                    onChange={(e) => setContactInput(e.target.value)}
                                    placeholder="Teléfono o email de compra"
                                    className="flex-1 px-4 py-2.5 bg-transparent text-sm text-white placeholder-muted focus:outline-none"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-light text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                            >
                                <Search className="w-4 h-4" />
                                <span>{loading ? "Buscando…" : "Buscar pedido"}</span>
                            </button>
                        </div>
                    </form>

                    {error && (
                        <p role="alert" className="max-w-xl mx-auto mb-8 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-center">
                            {error}
                        </p>
                    )}
                </FadeIn>

                {order && fulfillment && payment ? (
                    <div className="space-y-8">
                        {/* Status Card Banner */}
                        <FadeIn delay={0.1}>
                            <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-surface-card via-surface to-primary/10 border border-primary/20 glow-purple">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                                            <h2 className="font-heading text-2xl font-bold text-white">
                                                Orden #{order.ref}
                                            </h2>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${fulfillment.className}`}>
                                                {fulfillment.label}
                                            </span>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${payment.className}`}>
                                                {payment.label}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted">
                                            Pedido realizado: {new Date(order.createdAt).toLocaleString("es-CO")} • Destino: {order.city}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-3 flex-wrap">
                                        <button
                                            onClick={() => void handleReorder()}
                                            disabled={reorderState === "adding"}
                                            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 ${
                                                reorderState === "added"
                                                    ? "bg-green-600 text-white"
                                                    : "bg-white/10 hover:bg-white/20 text-white"
                                            }`}
                                        >
                                            {reorderState === "added" ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                            <span>
                                                {reorderState === "added"
                                                    ? "¡Agregado al Carrito!"
                                                    : reorderState === "unavailable"
                                                      ? "Productos no disponibles"
                                                      : reorderState === "adding"
                                                        ? "Agregando…"
                                                        : "Pedir de Nuevo"}
                                            </span>
                                        </button>

                                        {(() => {
                                            const supportUrl = buildSupportWhatsAppUrl(
                                                `Hola LuzMágica, requiero información sobre el estado de mi orden #${order.ref}`,
                                            );
                                            return supportUrl ? (
                                                <a
                                                    href={supportUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="px-4 py-2.5 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 text-xs font-semibold flex items-center gap-2 transition-colors"
                                                >
                                                    <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                                                    <span>Soporte WhatsApp</span>
                                                </a>
                                            ) : null;
                                        })()}
                                    </div>
                                </div>

                                {/* Logistics details row */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 text-xs">
                                    <div>
                                        <span className="text-muted block mb-1">Transportadora</span>
                                        <span className="font-semibold text-white flex items-center gap-1.5">
                                            <Truck className="w-3.5 h-3.5 text-primary" />
                                            {order.carrier ?? "Por asignar"}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Número de Guía</span>
                                        <span className="font-mono font-bold text-accent">
                                            {order.trackingNumber ?? "Pendiente"}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Destino</span>
                                        <span className="font-semibold text-white flex items-center gap-1.5">
                                            <MapPin className="w-3.5 h-3.5 text-secondary" />
                                            {order.city}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Total</span>
                                        <span className="font-bold text-white">{formatCOP(order.totalCop)}</span>
                                    </div>
                                </div>
                            </div>
                        </FadeIn>

                        {/* Timeline */}
                        <FadeIn delay={0.2}>
                            <div className="glass rounded-3xl p-6 md:p-8">
                                <h3 className="font-heading text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary" />
                                    <span>Línea de Tiempo del Despacho</span>
                                </h3>

                                {order.events.length === 0 ? (
                                    <p className="text-xs text-muted">Aún no hay eventos registrados para este pedido.</p>
                                ) : (
                                    <div className="relative pl-6 md:pl-8 space-y-8 before:absolute before:left-3 md:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-white/10">
                                        {order.events.map((evt, idx) => (
                                            <div key={idx} className="relative group">
                                                <div className="absolute -left-6 md:-left-8 top-1 w-6 h-6 rounded-full flex items-center justify-center text-xs bg-green-500 text-black shadow-lg shadow-green-500/20">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                </div>
                                                <div className="p-4 rounded-2xl bg-surface-card/60 border border-white/5">
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                                                        <h4 className="text-sm font-semibold text-white">{evt.label}</h4>
                                                        <span className="text-[11px] font-mono text-muted">
                                                            {new Date(evt.timestamp).toLocaleString("es-CO")}
                                                        </span>
                                                    </div>
                                                    {evt.description && <p className="text-xs text-muted">{evt.description}</p>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </FadeIn>

                        {/* Items */}
                        <FadeIn delay={0.3}>
                            <div className="glass rounded-3xl p-6 md:p-8">
                                <h3 className="font-heading text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <PackageCheck className="w-5 h-5 text-secondary" />
                                    <span>Artículos del Pedido</span>
                                </h3>

                                <div className="space-y-4">
                                    {order.items.map((item) => (
                                        <div
                                            key={item.productId}
                                            className="flex items-center justify-between p-4 rounded-2xl bg-surface-card border border-white/5"
                                        >
                                            <div>
                                                <h4 className="text-sm font-semibold text-white">{item.name}</h4>
                                                <p className="text-xs text-muted">
                                                    Cantidad: {item.quantity} • {formatCOP(item.unitPriceCop)} c/u
                                                </p>
                                            </div>
                                            <span className="text-sm font-bold text-white">
                                                {formatCOP(item.unitPriceCop * item.quantity)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="pt-3 border-t border-white/10 space-y-1.5 text-xs">
                                        <div className="flex justify-between text-muted">
                                            <span>Subtotal</span>
                                            <span className="text-white">{formatCOP(order.subtotalCop)}</span>
                                        </div>
                                        {order.discountCop > 0 && (
                                            <div className="flex justify-between text-green-400">
                                                <span>Descuento</span>
                                                <span>-{formatCOP(order.discountCop)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-muted">
                                            <span>Envío</span>
                                            <span className="text-white">{formatCOP(order.shippingCop)}</span>
                                        </div>
                                        <div className="flex justify-between font-bold text-white text-sm pt-1">
                                            <span>Total</span>
                                            <span>{formatCOP(order.totalCop)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </FadeIn>

                        {/* Post-delivery review form */}
                        <FadeIn delay={0.35}>
                            <ReviewForm order={order} contact={contactInput.trim()} />
                        </FadeIn>
                    </div>
                ) : (
                    !error && (
                        <div className="text-center py-12 text-muted text-sm">
                            Ingresa tu referencia y dato de contacto para ver el estado del pedido.
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
