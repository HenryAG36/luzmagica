"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, Sparkles, ShieldCheck } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";

const emptySubscribe = () => () => {};

export default function CartClient() {
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
    const {
        items,
        removeItem,
        updateQuantity,
        getSubtotal,
        getShippingBreakdown,
        getFreeShippingProgress,
    } = useCartStore();

    if (!mounted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando carrito...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="text-center max-w-md mx-auto">
                        <ShoppingBag className="w-16 h-16 text-muted mx-auto mb-6" />
                        <h1 className="font-heading text-3xl font-bold text-white mb-3">
                            Tu carrito está vacío
                        </h1>
                        <p className="text-muted text-sm mb-8">
                            Explora nuestra colección de iluminación LED mágica y acumula puntos LuzClub.
                        </p>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all"
                        >
                            <span>Ver Catálogo</span>
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const subtotal = getSubtotal();
    const breakdown = getShippingBreakdown();
    const total = breakdown.total;
    const shippingProgress = getFreeShippingProgress();
    const dsPresent = breakdown.dsItemCount > 0;
    const pointsToEarn = Math.floor((total ?? 0) / 1000);

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-5xl mx-auto">
                <FadeIn>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <h1 className="font-heading text-3xl sm:text-4xl font-bold">
                            Tu <span className="gradient-text">Carrito de Compras</span>
                        </h1>
                        <span className="text-xs text-muted">
                            {items.length} {items.length === 1 ? "artículo" : "artículos"}
                        </span>
                    </div>

                    {/* Free shipping bar (legacy national items only) */}
                    {(!dsPresent || breakdown.legacyItemCount > 0) && (
                        <div className="p-4 rounded-2xl bg-surface-card border border-white/10 mb-8">
                            <div className="flex items-center justify-between text-xs mb-2">
                                <span className="flex items-center gap-2 text-white font-medium">
                                    <Truck className="w-4 h-4 text-primary" />
                                    {shippingProgress.isFree
                                        ? "¡Felicidades! Tienes Envío Gratis Nacional"
                                        : `Agrega ${formatCOP(shippingProgress.remaining)} para obtener Envío Gratis en Colombia`}
                                    {dsPresent && " (solo productos nacionales)"}
                                </span>
                                <span className="text-muted font-mono">{shippingProgress.percent}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                                    style={{ width: `${shippingProgress.percent}%` }}
                                />
                            </div>
                        </div>
                    )}
                </FadeIn>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Items */}
                    <div className="lg:col-span-2 space-y-4">
                        {items.map((item, i) => (
                            <FadeIn key={item.product.id} delay={i * 0.05}>
                                <div className="glass rounded-2xl p-4 sm:p-6 flex gap-4 items-center">
                                    {/* Image */}
                                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-gradient-to-br from-primary/20 via-surface to-secondary/10 flex items-center justify-center flex-shrink-0 text-3xl border border-white/5">
                                        💡
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <Link
                                            href={`/products/${item.product.id}`}
                                            className="font-heading font-semibold text-white hover:text-primary transition-colors line-clamp-1 text-sm sm:text-base"
                                        >
                                            {item.product.name}
                                        </Link>
                                        <p className="text-sm sm:text-base font-bold text-accent mt-1">
                                            {formatCOP(item.product.price)}
                                        </p>

                                        <div className="flex items-center justify-between mt-3">
                                            {/* Quantity */}
                                            <div className="flex items-center glass rounded-lg">
                                                <button
                                                    onClick={() =>
                                                        updateQuantity(
                                                            item.product.id,
                                                            item.quantity - 1
                                                        )
                                                    }
                                                    className="px-2.5 py-1 text-muted hover:text-white transition-colors"
                                                    aria-label="Disminuir cantidad"
                                                >
                                                    <Minus className="w-3 h-3" />
                                                </button>
                                                <span className="px-3 py-1 text-xs text-white font-semibold">
                                                    {item.quantity}
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        updateQuantity(
                                                            item.product.id,
                                                            item.quantity + 1
                                                        )
                                                    }
                                                    className="px-2.5 py-1 text-muted hover:text-white transition-colors"
                                                    aria-label="Aumentar cantidad"
                                                >
                                                    <Plus className="w-3 h-3" />
                                                </button>
                                            </div>

                                            {/* Remove */}
                                            <button
                                                onClick={() => removeItem(item.product.id)}
                                                className="text-muted hover:text-red-400 transition-colors p-1"
                                                aria-label="Eliminar producto"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Subtotal */}
                                    <div className="hidden sm:block text-right">
                                        <span className="text-base font-bold text-white">
                                            {formatCOP(item.product.price * item.quantity)}
                                        </span>
                                    </div>
                                </div>
                            </FadeIn>
                        ))}
                    </div>

                    {/* Summary */}
                    <FadeIn delay={0.2}>
                        <div className="glass rounded-2xl p-6 sticky top-28 h-fit">
                            <h2 className="font-heading text-lg font-bold text-white mb-6">
                                Resumen del Pedido
                            </h2>

                            <div className="space-y-3.5 mb-6 text-xs sm:text-sm">
                                <div className="flex justify-between text-muted">
                                    <span>Subtotal</span>
                                    <span className="text-white font-medium">{formatCOP(subtotal)}</span>
                                </div>
                                {breakdown.discountCop > 0 && (
                                    <div className="flex justify-between text-green-400">
                                        <span>Descuentos (cupón / puntos)</span>
                                        <span>-{formatCOP(breakdown.discountCop)}</span>
                                    </div>
                                )}
                                {breakdown.legacyItemCount > 0 && (
                                    <div className="flex justify-between text-muted">
                                        <span>Envío Nacional (productos locales)</span>
                                        <span className={breakdown.legacyShippingCop === 0 ? "text-secondary font-semibold" : "text-white"}>
                                            {breakdown.legacyShippingCop === 0 ? "¡Gratis!" : formatCOP(breakdown.legacyShippingCop)}
                                        </span>
                                    </div>
                                )}
                                {dsPresent && (
                                    <div className="flex justify-between text-muted">
                                        <span>Envío internacional (estimado, por unidad, a Bogotá)</span>
                                        {breakdown.dsShippingCop === null ? (
                                            <span className="text-amber-300">Pendiente de cotización</span>
                                        ) : (
                                            <span className="text-white">{formatCOP(breakdown.dsShippingCop)}</span>
                                        )}
                                    </div>
                                )}

                                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between text-xs">
                                    <span className="text-muted flex items-center gap-1.5">
                                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                                        Puntos a acumular:
                                    </span>
                                    <span className="font-bold text-primary">+{pointsToEarn} pts</span>
                                </div>

                                <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                                    <span className="font-bold text-white text-base">Total Estimado</span>
                                    {total === null ? (
                                        <span className="text-sm text-amber-300">Pendiente de cotización</span>
                                    ) : (
                                        <span className="text-2xl font-bold gradient-text">
                                            {formatCOP(total)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <Link href="/checkout">
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all text-sm cursor-pointer"
                                >
                                    <span>Proceder al Checkout Seguro</span>
                                    <ArrowRight className="w-4 h-4" />
                                </motion.button>
                            </Link>

                            <div className="mt-5 pt-4 border-t border-white/5 space-y-2 text-[11px] text-muted">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-3.5 h-3.5 text-secondary" />
                                    <span>Compras en configuración; pagos próximamente</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Truck className="w-3.5 h-3.5 text-primary" />
                                    <span>El envío se confirma antes de completar el pedido</span>
                                </div>
                            </div>

                            <Link
                                href="/products"
                                className="block text-center text-xs text-muted hover:text-primary mt-4 transition-colors"
                            >
                                Continuar explorando productos
                            </Link>
                        </div>
                    </FadeIn>
                </div>
            </div>
        </div>
    );
}
