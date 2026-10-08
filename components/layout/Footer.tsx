"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Send, Instagram, Award } from "lucide-react";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";

const footerLinks = {
    tienda: [
        { label: "Todos los Productos", href: "/products" },
        { label: "Dormitorio", href: "/products?room=dormitorio" },
        { label: "Sala de Estar", href: "/products?room=sala" },
        { label: "Gaming", href: "/products?room=gaming" },
        { label: "Cocina", href: "/products?room=cocina" },
    ],
    retencion: [
        { label: "Rastrear mi Pedido", href: "/tracking" },
        { label: "Seguimiento y Soporte", href: "/tracking" },
        { label: "Portal del Operador (Admin)", href: "/operator" },
    ],
    legal: [
        { label: "Términos y Condiciones", href: "/legal/terminos" },
        { label: "Devoluciones y Retracto", href: "/legal/devoluciones" },
        { label: "Política de Privacidad", href: "/legal/privacidad" },
    ],
};

export default function Footer() {
    const [email, setEmail] = useState("");
    const [subscribed, setSubscribed] = useState(false);
    const { openModal } = useLoyaltyStore();

    const handleSubscribe = (e: React.FormEvent) => {
        e.preventDefault();
        if (email) {
            setSubscribed(true);
            setEmail("");
            setTimeout(() => setSubscribed(false), 3000);
        }
    };

    return (
        <footer className="relative border-t border-primary/20 mt-20">
            {/* RGB gradient line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-accent" />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
                    {/* Brand */}
                    <div className="col-span-1 lg:col-span-1">
                        <Link href="/" className="flex items-center gap-2 mb-4">
                            <Sparkles className="w-6 h-6 text-primary" />
                            <span className="font-heading text-xl font-bold">
                                <span className="text-white">Luz</span>
                                <span className="gradient-text">Mágica</span>
                            </span>
                        </Link>
                        <p className="text-muted text-xs leading-relaxed mb-6">
                            Tienda de iluminación LED decorativa con catálogo de proveedores nacionales e internacionales.
                        </p>
                        <div className="flex gap-3">
                            <a
                                href="#"
                                className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted hover:text-primary hover:glow-purple transition-all"
                                aria-label="Instagram"
                            >
                                <Instagram className="w-5 h-5" />
                            </a>
                            <button
                                onClick={openModal}
                                className="px-3 py-1.5 rounded-full bg-surface-card hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5 border border-primary/30"
                            >
                                <Award className="w-4 h-4 text-accent" />
                                <span>LuzClub VIP</span>
                            </button>
                        </div>
                    </div>

                    {/* Links - Tienda */}
                    <div>
                        <h3 className="font-heading font-semibold text-white text-sm mb-4">Colecciones</h3>
                        <ul className="space-y-2.5">
                            {footerLinks.tienda.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-xs text-muted hover:text-primary transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Links - Retención & Servicio */}
                    <div>
                        <h3 className="font-heading font-semibold text-white text-sm mb-4">Servicio & Rastreo</h3>
                        <ul className="space-y-2.5">
                            {footerLinks.retencion.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-xs text-muted hover:text-secondary transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                            <li>
                                <button
                                    onClick={openModal}
                                    className="text-xs text-accent hover:underline text-left cursor-pointer"
                                >
                                    Mis Puntos y Recompensas
                                </button>
                            </li>
                        </ul>
                    </div>

                    {/* Newsletter / Win-back capture */}
                    <div>
                        <h3 className="font-heading font-semibold text-white text-sm mb-2">Club VIP LuzMágica</h3>
                        <p className="text-xs text-muted mb-4">
                            Recibe un cupón del 10% en tu primer pedido y acumula puntos con cada compra.
                        </p>
                        <form onSubmit={handleSubscribe} className="flex gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="tu@email.com"
                                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-primary/20 text-xs text-white placeholder-muted focus:outline-none focus:border-primary transition-colors"
                            />
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                type="submit"
                                className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-light text-white transition-colors"
                                aria-label="Suscribirme"
                            >
                                <Send className="w-4 h-4" />
                            </motion.button>
                        </form>
                        {subscribed && (
                            <motion.p
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-xs text-green-400 mt-2"
                            >
                                ¡Bienvenido al Club! Tu código de bienvenida es MAGIA10 ✨
                            </motion.p>
                        )}
                    </div>
                </div>

                {/* Bottom Copyright */}
                <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-[11px] text-muted gap-2">
                    <p>© 2026 LuzMágica Colombia. Arquitectura de Comercio & Retención de Audiencia.</p>
                    <div className="flex items-center gap-4">
                        {footerLinks.legal.map((link) => (
                            <Link key={link.href} href={link.href} className="hover:text-white transition-colors">
                                {link.label}
                            </Link>
                        ))}
                        <Link href="/operator" className="text-primary hover:underline">
                            Acceso Operador
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
