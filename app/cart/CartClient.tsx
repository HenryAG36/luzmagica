"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";

export default function CartClient() {
    const [mounted, setMounted] = useState(false);
    const { items, removeItem, updateQuantity, getTotalPrice } = useCartStore();

    useEffect(() => setMounted(true), []);

    if (!mounted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="text-center">
                        <ShoppingBag className="w-16 h-16 text-muted mx-auto mb-6" />
                        <h1 className="font-heading text-3xl font-bold text-white mb-3">
                            Tu carrito está vacío
                        </h1>
                        <p className="text-muted mb-8">
                            Explora nuestra colección y encuentra la iluminación perfecta.
                        </p>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all"
                        >
                            Ver Productos
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const total = getTotalPrice();
    const shipping = total >= 150000 ? 0 : 15000;

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-5xl mx-auto">
                <FadeIn>
                    <h1 className="font-heading text-4xl sm:text-5xl font-bold mb-12">
                        Tu <span className="gradient-text">Carrito</span>
                    </h1>
                </FadeIn>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Items */}
                    <div className="lg:col-span-2 space-y-4">
                        {items.map((item, i) => (
                            <FadeIn key={item.product.id} delay={i * 0.05}>
                                <div className="glass rounded-2xl p-4 sm:p-6 flex gap-4">
                                    {/* Image */}
                                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-gradient-to-br from-primary/20 via-surface to-secondary/10 flex items-center justify-center flex-shrink-0">
                                        <span className="text-3xl">💡</span>
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <Link
                                            href={`/products/${item.product.id}`}
                                            className="font-heading font-semibold text-white hover:text-primary transition-colors line-clamp-1"
                                        >
                                            {item.product.name}
                                        </Link>
                                        <p className="text-lg font-bold text-white mt-1">
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
                                                    className="px-2 py-1.5 text-muted hover:text-white transition-colors"
                                                >
                                                    <Minus className="w-3 h-3" />
                                                </button>
                                                <span className="px-3 py-1.5 text-sm text-white font-semibold">
                                                    {item.quantity}
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        updateQuantity(
                                                            item.product.id,
                                                            item.quantity + 1
                                                        )
                                                    }
                                                    className="px-2 py-1.5 text-muted hover:text-white transition-colors"
                                                >
                                                    <Plus className="w-3 h-3" />
                                                </button>
                                            </div>

                                            {/* Remove */}
                                            <button
                                                onClick={() => removeItem(item.product.id)}
                                                className="text-muted hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Subtotal */}
                                    <div className="hidden sm:block text-right">
                                        <span className="text-lg font-bold text-white">
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
                            <h2 className="font-heading text-xl font-bold text-white mb-6">
                                Resumen del pedido
                            </h2>

                            <div className="space-y-4 mb-6">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted">Subtotal</span>
                                    <span className="text-white">{formatCOP(total)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted">Envío</span>
                                    <span className={shipping === 0 ? "text-secondary" : "text-white"}>
                                        {shipping === 0 ? "Gratis" : formatCOP(shipping)}
                                    </span>
                                </div>
                                {shipping > 0 && (
                                    <p className="text-xs text-muted">
                                        Envío gratis en pedidos mayores a {formatCOP(150000)}
                                    </p>
                                )}
                                <div className="border-t border-primary/20 pt-4 flex justify-between">
                                    <span className="font-semibold text-white">Total</span>
                                    <span className="text-2xl font-bold gradient-text">
                                        {formatCOP(total + shipping)}
                                    </span>
                                </div>
                            </div>

                            <Link href="/checkout">
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all"
                                >
                                    Ir al Checkout
                                    <ArrowRight className="w-4 h-4" />
                                </motion.button>
                            </Link>

                            <Link
                                href="/products"
                                className="block text-center text-sm text-muted hover:text-primary mt-4 transition-colors"
                            >
                                Continuar comprando
                            </Link>
                        </div>
                    </FadeIn>
                </div>
            </div>
        </div>
    );
}
