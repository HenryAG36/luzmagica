"use client";

import Link from "next/link";
import { useState, useEffect, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, Menu, X, Sparkles, LayoutDashboard, User, ShieldCheck, LogOut } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { useAuthStore } from "@/store/useAuthStore";

const emptySubscribe = () => () => {};

const navLinks = [
    { href: "/", label: "Inicio" },
    { href: "/products", label: "Catálogo" },
    { href: "/tracking", label: "Rastrear Pedido" },
];

export default function Navbar() {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

    const getTotalItems = useCartStore((s) => s.getTotalItems);
    const { account, openModal } = useLoyaltyStore();
    const { currentUser, logout } = useAuthStore();

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const itemCount = mounted ? getTotalItems() : 0;
    const points = mounted ? account.points : 0;

    return (
        <motion.nav
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`fixed top-0 left-0 right-0 z-40 transition-all duration-500 ${
                isScrolled ? "glass-strong py-3" : "bg-transparent py-5"
            }`}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 group">
                    <Sparkles className="w-6 h-6 text-primary transition-all group-hover:text-secondary" />
                    <span className="font-heading text-xl font-bold tracking-tight">
                        <span className="text-white">Luz</span>
                        <span className="gradient-text">Mágica</span>
                    </span>
                </Link>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-6">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-xs font-medium text-muted hover:text-white transition-colors relative group"
                        >
                            {link.label}
                            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary group-hover:w-full transition-all duration-300" />
                        </Link>
                    ))}
                </div>

                {/* Actions & Loyalty Pill */}
                <div className="flex items-center gap-3">
                    {/* LuzPoints Club Pill */}
                    <button
                        onClick={openModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-card hover:bg-primary/20 border border-primary/30 text-white text-xs font-semibold transition-all glow-purple cursor-pointer"
                        title="Ver tus puntos y recompensas LuzClub"
                    >
                        <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
                        <span className="hidden sm:inline">LuzClub:</span>
                        <span className="text-accent font-mono">{points} pts</span>
                    </button>

                    {/* Authentication Status & Actions */}
                    {mounted && currentUser ? (
                        <div className="flex items-center gap-2">
                            {currentUser.role === "admin" ? (
                                <Link
                                    href="/operator"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition-colors"
                                    title="Command Center del Operador"
                                >
                                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                                    <span className="hidden sm:inline">Admin</span>
                                </Link>
                            ) : (
                                <Link
                                    href="/account"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-colors"
                                    title="Mi Cuenta"
                                >
                                    <User className="w-3.5 h-3.5 text-primary" />
                                    <span className="hidden sm:inline">{currentUser.name.split(" ")[0]}</span>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <Link
                            href="/login"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-colors"
                        >
                            <User className="w-3.5 h-3.5 text-muted" />
                            <span>Ingresar</span>
                        </Link>
                    )}

                    {/* Cart Icon */}
                    <Link
                        href="/cart"
                        className="relative p-2 rounded-xl text-muted hover:text-white hover:bg-white/5 transition-colors"
                        aria-label="Carrito de compras"
                    >
                        <ShoppingCart className="w-5 h-5" />
                        {itemCount > 0 && (
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute top-1 right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center"
                            >
                                {itemCount}
                            </motion.span>
                        )}
                    </Link>

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden text-muted hover:text-white transition-colors p-1"
                        onClick={() => setIsMobileOpen(!isMobileOpen)}
                        aria-label="Abrir menú"
                    >
                        {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            <AnimatePresence>
                {isMobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="md:hidden glass-strong mt-2 mx-4 rounded-2xl overflow-hidden border border-white/10"
                    >
                        <div className="p-5 flex flex-col gap-3 text-sm">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setIsMobileOpen(false)}
                                    className="text-muted hover:text-white transition-colors py-1"
                                >
                                    {link.label}
                                </Link>
                            ))}

                            <div className="pt-3 border-t border-white/10 flex flex-col gap-2">
                                <button
                                    onClick={() => {
                                        setIsMobileOpen(false);
                                        openModal();
                                    }}
                                    className="w-full text-left text-accent py-1.5 flex items-center justify-between"
                                >
                                    <span className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4" />
                                        <span>LuzClub VIP Recompensas</span>
                                    </span>
                                    <span className="font-mono font-bold">{points} pts</span>
                                </button>

                                {currentUser ? (
                                    <>
                                        <Link
                                            href="/account"
                                            onClick={() => setIsMobileOpen(false)}
                                            className="text-white py-1.5 flex items-center gap-2"
                                        >
                                            <User className="w-4 h-4 text-primary" />
                                            <span>Mi Cuenta ({currentUser.name})</span>
                                        </Link>

                                        {currentUser.role === "admin" && (
                                            <Link
                                                href="/operator"
                                                onClick={() => setIsMobileOpen(false)}
                                                className="text-amber-300 py-1.5 flex items-center gap-2 font-semibold"
                                            >
                                                <LayoutDashboard className="w-4 h-4" />
                                                <span>Command Center del Operador</span>
                                            </Link>
                                        )}

                                        <button
                                            onClick={() => {
                                                void logout();
                                                setIsMobileOpen(false);
                                            }}
                                            className="text-red-400 py-1.5 flex items-center gap-2 text-left"
                                        >
                                            <LogOut className="w-4 h-4" />
                                            <span>Cerrar Sesión</span>
                                        </button>
                                    </>
                                ) : (
                                    <Link
                                        href="/login"
                                        onClick={() => setIsMobileOpen(false)}
                                        className="text-primary py-1.5 flex items-center gap-2"
                                    >
                                        <User className="w-4 h-4" />
                                        <span>Iniciar Sesión / Registrarme</span>
                                    </Link>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.nav>
    );
}
