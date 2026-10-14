"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Check, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useAuthStore } from "@/store/useAuthStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import ProductImage from "@/components/common/ProductImage";
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
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <FadeIn>
                <div className="rounded-3xl border border-black/10 bg-surface p-6 md:p-8">
                    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10 text-accent-dark">
                                <RotateCcw className="h-5 w-5" aria-hidden />
                            </div>
                            <div>
                                <h2 className="font-heading text-xl font-semibold md:text-2xl">
                                    Pedir de nuevo
                                </h2>
                                <p className="text-xs text-muted md:text-sm">
                                    Productos de tus compras anteriores, listos para ordenar otra vez
                                </p>
                            </div>
                        </div>
                        <Link
                            href="/cart"
                            className="inline-flex items-center gap-2 self-start text-xs font-semibold text-accent-dark transition-colors hover:underline md:self-auto"
                        >
                            <ShoppingBag className="h-4 w-4" aria-hidden />
                            Ir al carrito
                        </Link>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {products.map((product) => {
                            const isAdded = !!addedIds[product.id];
                            const soldOut = !Number.isFinite(product.stock) || product.stock <= 0;
                            return (
                                <div
                                    key={product.id}
                                    className="group flex items-center gap-4 rounded-2xl border border-black/10 bg-surface-light p-3.5 transition-colors hover:border-accent/40"
                                >
                                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface">
                                        <ProductImage src={product.images[0]} alt={product.name} sizes="64px" />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate text-xs font-semibold transition-colors group-hover:text-accent-dark">
                                            {product.name}
                                        </h3>
                                        <p className="mt-0.5 text-xs font-bold">
                                            {formatCOP(product.price)}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => handleReorder(product)}
                                        disabled={isAdded || soldOut}
                                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:bg-black/30"
                                    >
                                        {isAdded ? (
                                            <>
                                                <Check className="h-3.5 w-3.5" aria-hidden />
                                                <span>Añadido</span>
                                            </>
                                        ) : soldOut ? (
                                            <span>Agotado</span>
                                        ) : (
                                            <>
                                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
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
