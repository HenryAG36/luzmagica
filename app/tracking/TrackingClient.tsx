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
    Star,
    MessageCircle,
    CheckCircle2,
    Sparkles,
    Check,
} from "lucide-react";
import { useOrderStore } from "@/store/useOrderStore";
import { useCartStore } from "@/store/useCartStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import { OrderStatus } from "@/lib/types";

export default function TrackingClient() {
    const searchParams = useSearchParams();
    const { orders, getOrderById, submitReview } = useOrderStore();
    const { addItem } = useCartStore();
    const { awardPoints } = useLoyaltyStore();

    const queryOrderId = searchParams.get("orderId");
    const [selectedOrderId, setSelectedOrderId] = useState<string>("");
    const [searchInput, setSearchInput] = useState("");
    const [reordered, setReordered] = useState(false);

    // Review form state
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [reviewSubmitted, setReviewSubmitted] = useState(false);

    const activeOrderId =
        selectedOrderId ||
        (queryOrderId ? queryOrderId.trim().toUpperCase() : orders.length > 0 ? orders[0].id : "");

    const currentOrder = getOrderById(activeOrderId) || (orders.length > 0 ? orders[0] : null);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchInput.trim()) return;
        const found = getOrderById(searchInput);
        if (found) {
            setSelectedOrderId(found.id);
        } else {
            alert(`No encontramos ninguna orden con la referencia "${searchInput}". Intenta con LM-8921 o LM-9402.`);
        }
    };

    const handleReorder = () => {
        if (!currentOrder) return;
        currentOrder.items.forEach((item) => {
            addItem(item.product, item.quantity);
        });
        setReordered(true);
        setTimeout(() => setReordered(false), 2500);
    };

    const handleSubmitReview = (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentOrder || !comment.trim()) return;

        submitReview(currentOrder.id, rating, comment);
        // Bonus points for leaving verified review (replicates Owner loyalty reward loop)
        awardPoints(50000, currentOrder.id); // 50 pts bonus
        setReviewSubmitted(true);
    };

    const statusBadge = (status: OrderStatus) => {
        switch (status) {
            case "delivered":
                return <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">Entregado</span>;
            case "local_delivery":
                return <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">En Reparto Local</span>;
            case "customs_cleared":
                return <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">Nacionalizado DIAN</span>;
            case "international_transit":
                return <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Tránsito Internacional</span>;
            default:
                return <span className="px-3 py-1 rounded-full text-xs font-bold bg-primary/20 text-primary border border-primary/30">Preparación</span>;
        }
    };

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <FadeIn>
                    <div className="text-center max-w-2xl mx-auto mb-10">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 inline-block mb-3">
                            Transparencia en Logística & Despacho
                        </span>
                        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-3">
                            Rastreo de Pedido en <span className="gradient-text">Tiempo Real</span>
                        </h1>
                        <p className="text-xs sm:text-sm text-muted">
                            Sigue cada fase del envío dropshipping verificado desde fábrica hasta tu puerta.
                        </p>
                    </div>

                    {/* Search Bar */}
                    <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
                        <div className="flex gap-2 p-1.5 rounded-2xl bg-surface border border-white/10 glow-purple">
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Número de Orden (ej: LM-8921 o guía)"
                                className="flex-1 px-4 py-2.5 bg-transparent text-sm text-white placeholder-muted focus:outline-none"
                            />
                            <button
                                type="submit"
                                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-light text-white font-semibold text-xs transition-colors flex items-center gap-1.5"
                            >
                                <Search className="w-4 h-4" />
                                <span>Buscar</span>
                            </button>
                        </div>
                    </form>

                    {/* Quick Order Tabs */}
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-10">
                        <span className="text-xs text-muted mr-1">Tus pedidos recientes:</span>
                        {orders.map((o) => (
                            <button
                                key={o.id}
                                onClick={() => setSelectedOrderId(o.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all ${
                                    currentOrder?.id === o.id
                                        ? "bg-primary text-white border-primary glow-purple"
                                        : "bg-surface-card text-muted border-white/10 hover:text-white"
                                }`}
                            >
                                #{o.id}
                            </button>
                        ))}
                    </div>
                </FadeIn>

                {currentOrder ? (
                    <div className="space-y-8">
                        {/* Status Card Banner */}
                        <FadeIn delay={0.1}>
                            <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-surface-card via-surface to-primary/10 border border-primary/20 glow-purple">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h2 className="font-heading text-2xl font-bold text-white">
                                                Orden #{currentOrder.id}
                                            </h2>
                                            {statusBadge(currentOrder.status)}
                                        </div>
                                        <p className="text-xs text-muted">
                                            Fecha de compra: {currentOrder.date} • Destinatario: {currentOrder.customer.name}
                                        </p>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleReorder}
                                            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                                                reordered
                                                    ? "bg-green-600 text-white"
                                                    : "bg-white/10 hover:bg-white/20 text-white"
                                            }`}
                                        >
                                            {reordered ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                            <span>{reordered ? "¡Agregado al Carrito!" : "Pedir de Nuevo"}</span>
                                        </button>

                                        <a
                                            href={`https://wa.me/573104567890?text=${encodeURIComponent(
                                                `Hola LuzMágica, requiero información sobre el estado de mi orden #${currentOrder.id}`
                                            )}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-4 py-2.5 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 text-xs font-semibold flex items-center gap-2 transition-colors"
                                        >
                                            <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                                            <span>Soporte WhatsApp</span>
                                        </a>
                                    </div>
                                </div>

                                {/* Logistics details row */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 text-xs">
                                    <div>
                                        <span className="text-muted block mb-1">Transportadora Nacional</span>
                                        <span className="font-semibold text-white flex items-center gap-1.5">
                                            <Truck className="w-3.5 h-3.5 text-primary" />
                                            {currentOrder.carrier}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Número de Guía</span>
                                        <span className="font-mono font-bold text-accent">
                                            {currentOrder.trackingNumber}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Destino</span>
                                        <span className="font-semibold text-white flex items-center gap-1.5">
                                            <MapPin className="w-3.5 h-3.5 text-secondary" />
                                            {currentOrder.customer.city}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted block mb-1">Total Pagado</span>
                                        <span className="font-bold text-white">
                                            {formatCOP(currentOrder.total)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </FadeIn>

                        {/* Interactive Timeline */}
                        <FadeIn delay={0.2}>
                            <div className="glass rounded-3xl p-6 md:p-8">
                                <h3 className="font-heading text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary" />
                                    <span>Línea de Tiempo del Despacho</span>
                                </h3>

                                <div className="relative pl-6 md:pl-8 space-y-8 before:absolute before:left-3 md:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-white/10">
                                    {currentOrder.trackingEvents.map((evt, idx) => (
                                        <div key={idx} className="relative group">
                                            {/* Bullet */}
                                            <div
                                                className={`absolute -left-6 md:-left-8 top-1 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all ${
                                                    evt.completed
                                                        ? "bg-green-500 text-black shadow-lg shadow-green-500/20"
                                                        : "bg-surface-card border border-white/20 text-muted"
                                                }`}
                                            >
                                                {evt.completed ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-3.5 h-3.5" />}
                                            </div>

                                            {/* Event Content */}
                                            <div className="p-4 rounded-2xl bg-surface-card/60 border border-white/5 hover:border-white/15 transition-all">
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                                                    <h4 className={`text-sm font-semibold ${evt.completed ? "text-white" : "text-muted"}`}>
                                                        {evt.label}
                                                    </h4>
                                                    <span className="text-[11px] font-mono text-muted">{evt.timestamp}</span>
                                                </div>
                                                <p className="text-xs text-muted mb-2">{evt.description}</p>
                                                <div className="flex items-center gap-1 text-[11px] text-primary/80">
                                                    <MapPin className="w-3 h-3" />
                                                    <span>{evt.location}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </FadeIn>

                        {/* Order Items Breakdown */}
                        <FadeIn delay={0.3}>
                            <div className="glass rounded-3xl p-6 md:p-8">
                                <h3 className="font-heading text-lg font-bold text-white mb-6 flex items-center gap-2">
                                    <PackageCheck className="w-5 h-5 text-secondary" />
                                    <span>Artículos en este Envío</span>
                                </h3>

                                <div className="space-y-4">
                                    {currentOrder.items.map((item) => (
                                        <div
                                            key={item.product.id}
                                            className="flex items-center justify-between p-4 rounded-2xl bg-surface-card border border-white/5"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center text-2xl border border-white/5">
                                                    💡
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-semibold text-white">{item.product.name}</h4>
                                                    <p className="text-xs text-muted">
                                                        Cantidad: {item.quantity} • {formatCOP(item.product.price)} c/u
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-sm font-bold text-white">
                                                {formatCOP(item.product.price * item.quantity)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </FadeIn>

                        {/* Gated Post-Delivery Review Collection (Only when delivered, Owner pattern) */}
                        {currentOrder.status === "delivered" && (
                            <FadeIn delay={0.4}>
                                <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-br from-surface-card via-surface to-accent/10 border border-accent/20 glow-purple">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
                                            <Star className="w-5 h-5 fill-accent" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-heading text-lg font-bold text-white">
                                                    Califica tu Experiencia
                                                </h3>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-semibold border border-green-500/30">
                                                    Comprador Verificado
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted">
                                                Comparte tu opinión y recibe +50 puntos de fidelización LuzClub de regalo.
                                            </p>
                                        </div>
                                    </div>

                                    {currentOrder.review || reviewSubmitted ? (
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs">
                                            <div className="flex items-center gap-1 text-accent mb-2">
                                                {[...Array(currentOrder.review?.rating || rating)].map((_, i) => (
                                                    <Star key={i} className="w-4 h-4 fill-accent" />
                                                ))}
                                            </div>
                                            <p className="text-white italic">
                                                &ldquo;{currentOrder.review?.comment || comment}&rdquo;
                                            </p>
                                            <span className="text-[10px] text-green-400 block mt-2">
                                                ✓ Reseña verificada y publicada con éxito.
                                            </span>
                                        </div>
                                    ) : (
                                        <form onSubmit={handleSubmitReview} className="space-y-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted">Tu calificación:</span>
                                                <div className="flex gap-1">
                                                    {[1, 2, 3, 4, 5].map((s) => (
                                                        <button
                                                            key={s}
                                                            type="button"
                                                            onClick={() => setRating(s)}
                                                            className="p-1 hover:scale-110 transition-transform"
                                                        >
                                                            <Star
                                                                className={`w-6 h-6 ${
                                                                    s <= rating
                                                                        ? "text-accent fill-accent"
                                                                        : "text-white/20"
                                                                }`}
                                                            />
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div>
                                                <textarea
                                                    required
                                                    rows={3}
                                                    value={comment}
                                                    onChange={(e) => setComment(e.target.value)}
                                                    placeholder="¿Qué tal iluminó tu espacio? ¿Cómo fue el tiempo de entrega y el empaque?"
                                                    className="w-full px-4 py-3 rounded-2xl bg-surface border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-accent"
                                                />
                                            </div>

                                            <button
                                                type="submit"
                                                className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-black font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer"
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                                <span>Publicar Reseña & Ganar 50 Puntos</span>
                                            </button>
                                        </form>
                                    )}
                                </div>
                            </FadeIn>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-12 text-muted text-sm">
                        No hay pedidos registrados en este dispositivo.
                    </div>
                )}
            </div>
        </div>
    );
}
