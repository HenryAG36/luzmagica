"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FREE_SHIPPING_THRESHOLD } from "@/lib/cart/totals";
import { formatCOP } from "@/lib/utils";

export default function AnnouncementBar() {
    const pathname = usePathname();
    if (pathname?.startsWith("/checkout")) return null;

    return (
        <div className="bg-foreground text-white text-[11px] sm:text-xs">
            <div className="mx-auto flex max-w-7xl items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center flex-wrap">
                <Link href="/legal/devoluciones" className="hover:underline underline-offset-2">
                    Envío nacional gratis desde {formatCOP(FREE_SHIPPING_THRESHOLD)} en productos elegibles
                </Link>
                <span aria-hidden className="hidden sm:inline text-accent">◆</span>
                <span className="hidden sm:inline">Medios de pago disponibles según Wompi al pagar</span>
                <span aria-hidden className="hidden md:inline text-accent">◆</span>
                <Link href="/legal/devoluciones" className="hidden md:inline hover:underline underline-offset-2">
                    Consulta retracto y devoluciones
                </Link>
            </div>
        </div>
    );
}
