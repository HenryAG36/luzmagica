"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShoppingCart, Menu, X, Award, LayoutDashboard, User, ShieldCheck, LogOut, Search } from "lucide-react";
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
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [query, setQuery] = useState("");
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
    const pathname = usePathname();
    const router = useRouter();

    const itemCountValue = useCartStore((s) =>
        s.items.reduce((n, i) => n + i.quantity, 0),
    );
    const openCart = useCartStore((s) => s.openCart);
    const { openModal } = useLoyaltyStore();
    const { currentUser, logout } = useAuthStore();

    const itemCount = mounted ? itemCountValue : 0;
    const isCheckout = pathname?.startsWith("/checkout");

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        router.push(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
        setIsMobileOpen(false);
    };

    const logo = (
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="Honesty inicio">
            <Image
                src="/honesty-logo.jpg"
                alt="Honesty"
                width={44}
                height={36}
                className="h-9 w-auto object-contain"
                priority
            />
            <span className="font-heading text-xl font-semibold tracking-[0.18em] uppercase">
                Honesty
            </span>
        </Link>
    );

    if (isCheckout) {
        return (
            <nav className="bg-surface border-b border-black/10">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    {logo}
                    <Link
                        href="/cart"
                        className="flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
                    >
                        <ShoppingCart className="h-4 w-4" />
                        Volver al carrito
                    </Link>
                </div>
            </nav>
        );
    }

    return (
        <nav className="bg-surface/95 backdrop-blur border-b border-black/10">
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
                {logo}

                {/* Desktop nav */}
                <div className="hidden lg:flex items-center gap-6">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-sm font-medium text-muted transition-colors hover:text-foreground"
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>

                {/* Search */}
                <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-md mx-auto" role="search">
                    <label htmlFor="nav-search" className="sr-only">Buscar productos</label>
                    <div className="relative w-full">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                        <input
                            id="nav-search"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Buscar productos…"
                            className="w-full rounded-full border border-black/10 bg-surface-light py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/60"
                        />
                    </div>
                </form>

                {/* Actions */}
                <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                    <button
                        type="button"
                        onClick={openModal}
                        className="hidden sm:flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent-dark transition-colors hover:bg-accent/15"
                        title="Club Honesty"
                    >
                        <Award className="h-3.5 w-3.5" />
                        Club Honesty
                    </button>

                    {mounted && currentUser ? (
                        currentUser.role === "admin" ? (
                            <Link
                                href="/operator"
                                className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light"
                                title="Panel del operador"
                            >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Admin</span>
                            </Link>
                        ) : (
                            <Link
                                href="/account"
                                className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/5"
                                title="Mi cuenta"
                            >
                                <User className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{currentUser.name.split(" ")[0]}</span>
                            </Link>
                        )
                    ) : (
                        <Link
                            href="/login"
                            className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/5"
                        >
                            <User className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Ingresar</span>
                        </Link>
                    )}

                    <button
                        type="button"
                        onClick={openCart}
                        className="motion-press relative rounded-full p-2 text-foreground hover:bg-black/5"
                        aria-label={`Abrir carrito, ${itemCount} artículos`}
                    >
                        <ShoppingCart className="h-5 w-5" />
                        {itemCount > 0 && (
                            <span
                                key={itemCount}
                                className="motion-count absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-white"
                            >
                                {itemCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        className="motion-press rounded-full p-2 text-foreground hover:bg-black/5 lg:hidden"
                        onClick={() => setIsMobileOpen((v) => !v)}
                        aria-label={isMobileOpen ? "Cerrar menú" : "Abrir menú"}
                        aria-expanded={isMobileOpen}
                    >
                        {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            {isMobileOpen && (
                <div className="motion-reveal border-t border-black/10 bg-surface lg:hidden">
                    <div className="space-y-1 px-4 py-4">
                        <form onSubmit={handleSearch} role="search" className="mb-3 md:hidden">
                            <label htmlFor="nav-search-mobile" className="sr-only">Buscar productos</label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                                <input
                                    id="nav-search-mobile"
                                    type="search"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Buscar productos…"
                                    className="w-full rounded-full border border-black/10 bg-surface-light py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:border-accent/60"
                                />
                            </div>
                        </form>

                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setIsMobileOpen(false)}
                                className="block rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-black/5"
                            >
                                {link.label}
                            </Link>
                        ))}

                        <div className="mt-2 border-t border-black/10 pt-3 space-y-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsMobileOpen(false);
                                    openModal();
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-accent-dark hover:bg-accent/10"
                            >
                                <Award className="h-4 w-4" />
                                Club Honesty
                            </button>

                            {currentUser ? (
                                <>
                                    <Link
                                        href="/account"
                                        onClick={() => setIsMobileOpen(false)}
                                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5"
                                    >
                                        <User className="h-4 w-4" />
                                        Mi Cuenta ({currentUser.name})
                                    </Link>
                                    {currentUser.role === "admin" && (
                                        <Link
                                            href="/operator"
                                            onClick={() => setIsMobileOpen(false)}
                                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5"
                                        >
                                            <LayoutDashboard className="h-4 w-4" />
                                            Panel del operador
                                        </Link>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void logout();
                                            setIsMobileOpen(false);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-black/5"
                                    >
                                        <LogOut className="h-4 w-4" />
                                        Cerrar Sesión
                                    </button>
                                </>
                            ) : (
                                <Link
                                    href="/login"
                                    onClick={() => setIsMobileOpen(false)}
                                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5"
                                >
                                    <User className="h-4 w-4" />
                                    Iniciar Sesión / Registrarme
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
}
