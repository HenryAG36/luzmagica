"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Gift, ArrowRight, ShieldCheck, MessageCircle } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useOperatorStore } from "@/store/useOperatorStore";
import { formatCOP } from "@/lib/utils";

export default function ExitIntentRecoveryModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [hasTriggered, setHasTriggered] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

    const { items, getTotalPrice, applyCoupon, customerProfile } = useCartStore();
    const { captureAbandonedCart } = useOperatorStore();

    useEffect(() => {
        // Only trigger if cart has items and haven't triggered in this session
        if (items.length === 0 || hasTriggered) return;

        const handleMouseLeave = (e: MouseEvent) => {
            if (e.clientY <= 10 && !hasTriggered && items.length > 0) {
                setIsOpen(true);
                setHasTriggered(true);

                // Automatically capture to operator dashboard as an abandoned cart lead
                captureAbandonedCart(
                    items,
                    getTotalPrice(),
                    customerProfile.name,
                    customerProfile.phone,
                    customerProfile.email
                );
            }
        };

        document.addEventListener("mouseleave", handleMouseLeave);
        return () => document.removeEventListener("mouseleave", handleMouseLeave);
    }, [items, hasTriggered, getTotalPrice, captureAbandonedCart, customerProfile]);

    if (!isOpen || items.length === 0) return null;

    const total = getTotalPrice();
    const discountAmount = Math.round(total * 0.1);

    const handleApplyAndCheckout = () => {
        applyCoupon("MAGIA10");
        setIsOpen(false);
        if (pathname !== "/checkout") {
            router.push("/checkout");
        }
    };

    const handleWhatsAppHelp = () => {
        setIsOpen(false);
        const text = encodeURIComponent(
            `Hola LuzMágica, estoy interesado en comprar mis luces LED pero tengo una pregunta antes de pagar.`
        );
        window.open(`https://wa.me/573104567890?text=${text}`, "_blank");
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 30 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 30 }}
                    className="relative w-full max-w-lg rounded-3xl bg-surface border border-accent/30 p-6 md:p-8 shadow-2xl glow-purple overflow-hidden"
                >
                    {/* Top ambient glow */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent via-primary to-secondary" />

                    {/* Close button */}
                    <button
                        onClick={() => setIsOpen(false)}
                        className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                        aria-label="Cerrar"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Icon & Badge */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                            <Gift className="w-6 h-6" />
                        </div>
                        <div>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
                                Oferta Especial de Retención
                            </span>
                            <h3 className="font-heading text-xl md:text-2xl font-bold text-white">
                                ¡Espera! No te quedes a oscuras
                            </h3>
                        </div>
                    </div>

                    <p className="text-xs md:text-sm text-muted mb-5">
                        Guarda tus productos con un <strong className="text-white font-semibold">10% de descuento adicional</strong> y
                        despacho prioritario en toda Colombia.
                    </p>

                    {/* Promo Box */}
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 mb-5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted">Ahorro Inmediato:</span>
                            <span className="font-bold text-green-400">-{formatCOP(discountAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted">Cupón activado:</span>
                            <span className="font-mono font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-lg border border-accent/30">
                                MAGIA10
                            </span>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="space-y-2.5">
                        <button
                            onClick={handleApplyAndCheckout}
                            className="w-full py-3.5 px-6 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all text-sm"
                        >
                            <span>Aplicar 10% y Finalizar Compra</span>
                            <ArrowRight className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleWhatsAppHelp}
                            className="w-full py-3 px-6 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium flex items-center justify-center gap-2 border border-white/10 transition-colors text-xs"
                        >
                            <MessageCircle className="w-4 h-4 text-green-400" />
                            <span>¿Tienes dudas? Consulta por WhatsApp</span>
                        </button>
                    </div>

                    <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-center gap-4 text-[11px] text-muted">
                        <span className="flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Garantía 30 días
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-secondary" /> Puntos LuzClub incluidos
                        </span>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
