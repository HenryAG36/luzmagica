"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ShieldCheck, ArrowLeft, Check, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";

export default function CheckoutClient() {
    const [mounted, setMounted] = useState(false);
    const { items, getTotalPrice, clearCart } = useCartStore();
    const [submitted, setSubmitted] = useState(false);
    const [form, setForm] = useState({
        name: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        notes: "",
    });

    useEffect(() => setMounted(true), []);

    if (!mounted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando...</div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="text-center max-w-md mx-auto">
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", duration: 0.6 }}
                            className="w-20 h-20 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-6"
                        >
                            <Check className="w-10 h-10 text-green-500" />
                        </motion.div>
                        <h1 className="font-heading text-3xl font-bold text-white mb-3">
                            ¡Pedido Confirmado! 🎉
                        </h1>
                        <p className="text-muted mb-8">
                            Te enviaremos un email con los detalles de tu pedido. ¡Gracias por
                            comprar en LuzMágica!
                        </p>
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all"
                        >
                            Volver al Inicio
                        </Link>
                    </div>
                </FadeIn>
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
                            No hay items en el carrito
                        </h1>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all mt-6"
                        >
                            Ver Productos
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const total = getTotalPrice();
    const shipping = total >= 150000 ? 0 : 15000;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        clearCart();
        setSubmitted(true);
    };

    const updateField = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const inputClass =
        "w-full px-4 py-3 rounded-xl bg-surface border border-primary/20 text-white placeholder-muted focus:outline-none focus:border-primary transition-colors text-sm";

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-5xl mx-auto">
                <FadeIn>
                    <Link
                        href="/cart"
                        className="inline-flex items-center gap-2 text-sm text-muted hover:text-white transition-colors mb-8"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Volver al carrito
                    </Link>

                    <h1 className="font-heading text-4xl sm:text-5xl font-bold mb-12">
                        <span className="gradient-text">Checkout</span>
                    </h1>
                </FadeIn>

                <form onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Form */}
                        <div className="lg:col-span-2">
                            <FadeIn>
                                <div className="glass rounded-2xl p-6 sm:p-8">
                                    <h2 className="font-heading text-xl font-bold text-white mb-6">
                                        Información de Envío
                                    </h2>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="sm:col-span-2">
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Nombre completo *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={form.name}
                                                onChange={(e) => updateField("name", e.target.value)}
                                                placeholder="Tu nombre"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Email *
                                            </label>
                                            <input
                                                type="email"
                                                required
                                                value={form.email}
                                                onChange={(e) => updateField("email", e.target.value)}
                                                placeholder="tu@email.com"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Teléfono *
                                            </label>
                                            <input
                                                type="tel"
                                                required
                                                value={form.phone}
                                                onChange={(e) => updateField("phone", e.target.value)}
                                                placeholder="+57 300 000 0000"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Dirección *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={form.address}
                                                onChange={(e) => updateField("address", e.target.value)}
                                                placeholder="Calle, número, apartamento"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Ciudad *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={form.city}
                                                onChange={(e) => updateField("city", e.target.value)}
                                                placeholder="Bogotá"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted mb-1.5 block">
                                                Notas (opcional)
                                            </label>
                                            <input
                                                type="text"
                                                value={form.notes}
                                                onChange={(e) => updateField("notes", e.target.value)}
                                                placeholder="Instrucciones de entrega"
                                                className={inputClass}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </FadeIn>
                        </div>

                        {/* Order Summary */}
                        <FadeIn delay={0.2}>
                            <div className="glass rounded-2xl p-6 sticky top-28 h-fit">
                                <h2 className="font-heading text-xl font-bold text-white mb-6">
                                    Tu Pedido
                                </h2>

                                <div className="space-y-3 mb-6">
                                    {items.map((item) => (
                                        <div
                                            key={item.product.id}
                                            className="flex justify-between text-sm"
                                        >
                                            <span className="text-muted line-clamp-1 flex-1 mr-2">
                                                {item.product.name} × {item.quantity}
                                            </span>
                                            <span className="text-white font-medium">
                                                {formatCOP(item.product.price * item.quantity)}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-3 border-t border-primary/20 pt-4 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted">Subtotal</span>
                                        <span className="text-white">{formatCOP(total)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted">Envío</span>
                                        <span
                                            className={
                                                shipping === 0 ? "text-secondary" : "text-white"
                                            }
                                        >
                                            {shipping === 0 ? "Gratis" : formatCOP(shipping)}
                                        </span>
                                    </div>
                                    <div className="border-t border-primary/20 pt-3 flex justify-between">
                                        <span className="font-semibold text-white">Total</span>
                                        <span className="text-2xl font-bold gradient-text">
                                            {formatCOP(total + shipping)}
                                        </span>
                                    </div>
                                </div>

                                <motion.button
                                    type="submit"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all"
                                >
                                    <ShieldCheck className="w-5 h-5" />
                                    Confirmar Pedido
                                </motion.button>

                                <p className="text-xs text-muted text-center mt-4">
                                    🔒 Pago seguro garantizado
                                </p>
                            </div>
                        </FadeIn>
                    </div>
                </form>
            </div>
        </div>
    );
}
