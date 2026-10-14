import Link from "next/link";
import Image from "next/image";
import { PackageSearch, RotateCcw, CreditCard } from "lucide-react";

export default function Hero() {
    return (
        <section className="relative overflow-hidden">
            <div className="ambient-gradient absolute inset-0" />
            <div className="motion-intro relative mx-auto max-w-4xl px-4 pb-14 pt-14 text-center sm:pb-16 sm:pt-20">
                <Image
                    src="/honesty-logo.jpg"
                    alt="Escudo Honesty"
                    width={120}
                    height={98}
                    priority
                    className="mx-auto mb-6 h-24 w-auto object-contain"
                />
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-accent-dark">
                    Est. 2026 · Tienda Premium
                </p>
                <h1 className="mt-4 font-heading text-5xl font-semibold leading-tight sm:text-6xl lg:text-7xl">
                    Calidad honesta,
                    <br />
                    precios honestos.
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                    Un catálogo cuidado de productos nacionales e internacionales
                    con precios claros y envío cotizado antes de pagar.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link
                        href="/products"
                        className="motion-press rounded-full bg-foreground px-8 py-3.5 text-sm font-semibold text-white hover:bg-primary-light"
                    >
                        Explorar Catálogo
                    </Link>
                    <Link
                        href="/tracking"
                        className="motion-press rounded-full border border-black/15 px-8 py-3.5 text-sm font-semibold text-foreground hover:bg-black/5"
                    >
                        Rastrear pedido
                    </Link>
                </div>
                <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-black/10 pt-6 text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                        Medios disponibles según Wompi al pagar
                    </span>
                    <span className="flex items-center gap-1.5">
                        <PackageSearch className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                        <Link href="/tracking" className="hover:underline underline-offset-2">
                            Sigue tu pedido con tu referencia
                        </Link>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                        <Link href="/legal/devoluciones" className="hover:underline underline-offset-2">
                            Consulta retracto y devoluciones
                        </Link>
                    </span>
                </div>
            </div>
        </section>
    );
}
