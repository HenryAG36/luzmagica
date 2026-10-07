"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Check, ShoppingBag, Sparkles } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useAuthStore } from "@/store/useAuthStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import type { Product } from "@/lib/types";
import type { PublicOrder } from "@/lib/orders/types";

export default function OrderAgainSection() {
    const { addItem } = useCartStore();
    const { currentUser, authReady } = useAuthStore();
    const [products, setProducts] = useState<Product[] | null>(null);
    const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

    // Load recent products from the user's real paid orders. Items are
    // re-fetched so the displayed/added price is always the current one.
    useEffect(() => {
        if (!authReady || !currentUser) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/orders/mine");
                if (!res.ok) return;
                const body = await res.json();
                const orders = (body.orders ?? []) as PublicOrder[];
                const productIds: string[] = [];
                for (const order of orders) {
                    if (order.paymentStatus !== "paid") continue;
                    for (const item of order.items) {
                        if (!productIds.includes(item.productId)) productIds.push(item.productId);
                    }
                    if (productIds.length >= 3) break;
                }
                const fetched = await Promise.all(
                    productIds.slice(0, 3).map(async (id) => {
                        const r = await fetch(`/api/products/${encodeURIComponent(id)}`);
                        if (!r.ok) return null;
                        const b = await r.json();
                        return (b.product ?? null) as Product | null;
                    }),
                );
                if (!cancelled) setProducts(fetched.filter((p): p is Product => p !== null));
            } catch {
                // hide section on error
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [authReady, currentUser]);

    if (!currentUser || !products || products.length === 0) return null;

    const handleReorder = (product: Product) => {
        addItem(product, 1);
        setAddedIds((prev) => ({ ...prev, [product.id]: true }));
        setTimeout(() => {
            setAddedIds((prev) => ({ ...prev, [product.id]: false }));
        }, 2000);
    };

    return (
        <section className="py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <FadeIn>
                <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-surface-card via-surface to-primary/10 border border-primary/20 glow-purple">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
                                <RotateCcw className="w-5 h-5" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="font-heading text-xl md:text-2xl font-bold text-white">
                                        Pedir de Nuevo
                                    </h2>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/20 text-primary border border-primary/30">
                                        1 Clic
                                    </span>
                                </div>
                                <p className="text-xs md:text-sm text-muted">
                                    Productos que ya has disfrutado listos para ordenar nuevamente con envío express
                                </p>
                            </div>
                        </div>
                        <Link
                            href="/cart"
                            className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary-light transition-colors self-start md:self-auto"
                        >
                            <ShoppingBag className="w-4 h-4" />
                            Ir al carrito
                        </Link>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {products.map((product) => {
                            const isAdded = !!addedIds[product.id];
                            return (
                                <div
                                    key={product.id}
                                    className="flex items-center gap-4 p-3.5 rounded-2xl bg-surface/80 border border-white/5 hover:border-primary/40 transition-all group"
                                >
                                    {/* Image placeholder / icon */}
                                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 via-surface-card to-secondary/20 flex items-center justify-center text-2xl shrink-0 border border-white/5">
                                        💡
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors">
                                            {product.name}
                                        </h3>
                                        <p className="text-xs font-bold text-accent mt-0.5">
                                            {formatCOP(product.price)}
                                        </p>
                                        <div className="flex items-center gap-1 mt-1 text-[10px] text-muted">
                                            <Sparkles className="w-3 h-3 text-secondary" />
                                            <span>Acumula {Math.floor(product.price / 1000)} pts</span>
                                        </div>
                                    </div>

                                    {/* Action button */}
                                    <button
                                        onClick={() => handleReorder(product)}
                                        disabled={isAdded}
                                        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                                            isAdded
                                                ? "bg-green-600 text-white"
                                                : "bg-primary hover:bg-primary-light text-white glow-purple"
                                        }`}
                                    >
                                        {isAdded ? (
                                            <>
                                                <Check className="w-3.5 h-3.5" />
                                                <span>¡Añadido!</span>
                                            </>
                                        ) : (
                                            <>
                                                <RotateCcw className="w-3.5 h-3.5" />
                                                <span>Reordenar</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </FadeIn>
        </section>
    );
}
