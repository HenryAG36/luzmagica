"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { MessageCircle, Award } from "lucide-react";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { buildSupportWhatsAppUrl } from "@/lib/contact";

const footerLinks = {
    tienda: [
        { label: "Todos los Productos", href: "/products" },
        { label: "Rastrear Pedido", href: "/tracking" },
        { label: "Mi Cuenta", href: "/account" },
    ],
    legal: [
        { label: "Términos y condiciones", href: "/legal/terminos" },
        { label: "Retracto y devoluciones", href: "/legal/devoluciones" },
        { label: "Privacidad", href: "/legal/privacidad" },
    ],
};

export default function Footer() {
    const pathname = usePathname();
    const { openModal } = useLoyaltyStore();
    const supportUrl = buildSupportWhatsAppUrl("Hola Honesty, tengo una pregunta sobre mi pedido.");
    const isCheckout = pathname?.startsWith("/checkout");

    // Compact footer on checkout: legal/support only, no promotions.
    if (isCheckout) {
        return (
            <footer className="mt-10 border-t border-black/10 bg-surface">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-5 text-[11px] text-muted sm:px-6 lg:px-8">
                    {footerLinks.legal.map((link) => (
                        <Link key={link.label} href={link.href} className="transition-colors hover:text-foreground">
                            {link.label}
                        </Link>
                    ))}
                    {supportUrl && (
                        <a href={supportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                            <MessageCircle className="h-3 w-3" aria-hidden />
                            WhatsApp
                        </a>
                    )}
                </div>
            </footer>
        );
    }

    return (
        <footer className="mt-20 border-t border-black/10 bg-surface">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
                    {/* Brand */}
                    <div>
                        <Link href="/" className="mb-4 flex items-center gap-2.5">
                            <Image
                                src="/honesty-logo.jpg"
                                alt="Honesty"
                                width={40}
                                height={32}
                                className="h-8 w-auto object-contain"
                            />
                            <span className="font-heading text-lg font-semibold uppercase tracking-[0.18em]">
                                Honesty
                            </span>
                        </Link>
                        <p className="mb-5 text-xs leading-relaxed text-muted">
                            Tienda premium con catálogo de proveedores nacionales e internacionales.
                        </p>
                        <button
                            type="button"
                            onClick={openModal}
                            className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent-dark transition-colors hover:bg-accent/15"
                        >
                            <Award className="h-3.5 w-3.5" />
                            Club Honesty
                        </button>
                    </div>

                    {/* Shop links */}
                    <div>
                        <h3 className="mb-4 font-heading text-base font-semibold">Tienda</h3>
                        <ul className="space-y-2.5">
                            {footerLinks.tienda.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-xs text-muted transition-colors hover:text-foreground"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Legal links */}
                    <div>
                        <h3 className="mb-4 font-heading text-base font-semibold">Legal</h3>
                        <ul className="space-y-2.5">
                            {footerLinks.legal.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-xs text-muted transition-colors hover:text-foreground"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Club Honesty */}
                    <div>
                        <h3 className="mb-2 font-heading text-base font-semibold">Club Honesty</h3>
                        <p className="mb-4 text-xs leading-relaxed text-muted">
                            Consulta tus puntos y beneficios en tu cuenta.
                        </p>
                        <Link
                            href="/account"
                            className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-4 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
                        >
                            Ir a mi cuenta
                        </Link>
                        <p className="mt-4 text-[11px] leading-relaxed text-muted">
                            Con el cupón HONEST10 obtienes 10% de descuento sobre el subtotal de tu pedido.
                        </p>
                        {supportUrl && (
                            <a
                                href={supportUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
                            >
                                <MessageCircle className="h-3.5 w-3.5" />
                                Escríbenos por WhatsApp
                            </a>
                        )}
                    </div>
                </div>

                <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-black/10 pt-6 text-[11px] text-muted sm:flex-row">
                    <p>© 2026 Honesty. Todos los derechos reservados.</p>
                    <p>Medios de pago disponibles según Wompi al pagar.</p>
                </div>
            </div>
        </footer>
    );
}
