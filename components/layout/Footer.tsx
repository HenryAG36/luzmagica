"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Send, Instagram } from "lucide-react";

const footerLinks = {
    tienda: [
        { label: "Todos los Productos", href: "/products" },
        { label: "Dormitorio", href: "/products?room=dormitorio" },
        { label: "Sala de Estar", href: "/products?room=sala" },
        { label: "Gaming", href: "/products?room=gaming" },
        { label: "Cocina", href: "/products?room=cocina" },
    ],
    info: [
        { label: "Sobre Nosotros", href: "#" },
        { label: "Envíos", href: "#" },
        { label: "Devoluciones", href: "#" },
        { label: "Preguntas Frecuentes", href: "#" },
        { label: "Contacto", href: "#" },
    ],
};

const paymentMethods = ["Visa", "Mastercard", "PSE", "Nequi", "Daviplata"];

export default function Footer() {
    const [email, setEmail] = useState("");
    const [subscribed, setSubscribed] = useState(false);

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
                        <p className="text-muted text-sm leading-relaxed mb-6">
                            Ilumina tu vida con estilo. Líderes en decoración LED para toda Latinoamérica.
                        </p>
                        <div className="flex gap-3">
                            <a
                                href="#"
                                className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted hover:text-primary hover:glow-purple transition-all"
                            >
                                <Instagram className="w-5 h-5" />
                            </a>
                            <a
                                href="#"
                                className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted hover:text-primary hover:glow-purple transition-all"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.84a4.83 4.83 0 0 1-1-.15z" />
                                </svg>
                            </a>
                        </div>
                    </div>

                    {/* Links - Tienda */}
                    <div>
                        <h3 className="font-heading font-semibold text-white mb-4">Tienda</h3>
                        <ul className="space-y-3">
                            {footerLinks.tienda.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted hover:text-primary transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Links - Info */}
                    <div>
                        <h3 className="font-heading font-semibold text-white mb-4">Información</h3>
                        <ul className="space-y-3">
                            {footerLinks.info.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted hover:text-primary transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Newsletter */}
                    <div>
                        <h3 className="font-heading font-semibold text-white mb-4">Newsletter</h3>
                        <p className="text-sm text-muted mb-4">
                            Recibe ofertas exclusivas y las últimas novedades en iluminación LED.
                        </p>
                        <form onSubmit={handleSubscribe} className="flex gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="tu@email.com"
                                className="flex-1 px-4 py-2.5 rounded-lg bg-surface border border-primary/20 text-sm text-white placeholder-muted focus:outline-none focus:border-primary transition-colors"
                            />
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                type="submit"
                                className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-light text-white transition-colors"
                            >
                                <Send className="w-4 h-4" />
                            </motion.button>
                        </form>
                        {subscribed && (
                            <motion.p
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-sm text-secondary mt-2"
                            >
                                ¡Suscrito exitosamente! ✨
                            </motion.p>
                        )}
                    </div>
                </div>

                {/* Bottom */}
                <div className="mt-16 pt-8 border-t border-primary/10 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-muted">
                        © 2026 LuzMágica. Todos los derechos reservados.
                    </p>
                    <div className="flex items-center gap-3">
                        {paymentMethods.map((method) => (
                            <span
                                key={method}
                                className="text-[10px] px-2 py-1 rounded glass text-muted"
                            >
                                {method}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </footer>
    );
}
