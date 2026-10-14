"use client";

import { useSyncExternalStore, useMemo } from "react";
import Link from "next/link";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, ShieldCheck } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { formatCOP } from "@/lib/utils";
import { Product } from "@/lib/types";
import FadeIn from "@/components/common/FadeIn";
import ProductImage from "@/components/common/ProductImage";
import ProductCard from "@/components/products/ProductCard";

const emptySubscribe = () => () => {};

interface CartClientProps {
    catalogProducts?: Product[];
}

export default function CartClient({ catalogProducts = [] }: CartClientProps) {
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
    const {
        items,
        removeItem,
        updateQuantity,
        getSubtotal,
        getShippingBreakdown,
        getFreeShippingProgress,
    } = useCartStore();

    const upsell = useMemo(() => {
        const ids = new Set(items.map((i) => i.product.id));
        return catalogProducts.filter((p) => !ids.has(p.id) && p.stock > 0).slice(0, 4);
    }, [catalogProducts, items]);

    if (!mounted) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-16">
                <div className="animate-pulse text-muted">Cargando carrito...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-16">
                <FadeIn>
                    <div className="mx-auto max-w-md text-center">
                        <ShoppingBag className="mx-auto mb-6 h-16 w-16 text-muted" aria-hidden />
                        <h1 className="mb-3 font-heading text-3xl font-semibold">
                            Tu carrito está vacío
                        </h1>
                        <p className="mb-8 text-sm text-muted">
                            Explora el catálogo y encuentra algo que te guste.
                        </p>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-4 font-semibold text-white transition-colors hover:bg-primary-light"
                        >
                            <span>Ver catálogo</span>
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const subtotal = getSubtotal();
    const breakdown = getShippingBreakdown();
    const total = breakdown.total;
    const shippingProgress = getFreeShippingProgress();
    const dsPresent = breakdown.dsItemCount > 0;

    return (
        <div className="px-4 py-10">
            <div className="mx-auto max-w-5xl">
                <FadeIn>
                    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">
                            Tu carrito
                        </h1>
                        <span className="text-xs text-muted">
                            {items.length} {items.length === 1 ? "artículo" : "artículos"}
                        </span>
                    </div>

                    {/* Free shipping bar (national items only) */}
                    {breakdown.legacyItemCount > 0 && (
                        <div className="mb-8 rounded-2xl border border-black/10 bg-surface p-4">
                            <div className="mb-2 flex items-center justify-between text-xs">
                                <span className="flex items-center gap-2 font-medium text-foreground">
                                    <Truck className="h-4 w-4 text-accent-dark" aria-hidden />
                                    {shippingProgress.isFree
                                        ? "Envío nacional gratis en productos elegibles"
                                        : `Agrega ${formatCOP(shippingProgress.remaining)} en productos elegibles para envío nacional gratis`}
                                </span>
                                <span className="font-mono text-muted">{shippingProgress.percent}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-light">
                                <div
                                    className="motion-progress h-full rounded-full bg-accent"
                                    style={{ width: `${shippingProgress.percent}%` }}
                                />
                            </div>
                            <p className="mt-1.5 text-[11px] text-muted">
                                Solo los productos nacionales elegibles cuentan para este beneficio.
                            </p>
                        </div>
                    )}
                </FadeIn>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    {/* Items */}
                    <div className="space-y-4 lg:col-span-2">
                        {items.map((item, i) => {
                            const original = item.product.originalPrice;
                            const onSale =
                                typeof original === "number" &&
                                Number.isFinite(original) &&
                                original > item.product.price &&
                                item.product.price > 0;
                            return (
                                <FadeIn key={item.product.id} delay={i * 0.05}>
                                    <div className="flex items-center gap-4 rounded-2xl border border-black/10 bg-surface p-4 sm:p-5">
                                        {/* Image */}
                                        <Link
                                            href={`/products/${item.product.id}`}
                                            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-light sm:h-24 sm:w-24"
                                            aria-label={item.product.name}
                                        >
                                            <ProductImage
                                                src={item.product.images[0]}
                                                alt={item.product.name}
                                                sizes="96px"
                                            />
                                        </Link>

                                        {/* Info */}
                                        <div className="min-w-0 flex-1">
                                            <Link
                                                href={`/products/${item.product.id}`}
                                                className="line-clamp-1 text-sm font-semibold text-foreground transition-colors hover:text-accent-dark sm:text-base"
                                            >
                                                {item.product.name}
                                            </Link>
                                            <p className="mt-1 text-sm font-bold">
                                                {formatCOP(item.product.price)}
                                                {onSale && (
                                                    <span className="ml-2 text-xs font-medium text-muted line-through">
                                                        {formatCOP(original!)}
                                                    </span>
                                                )}
                                            </p>

                                            <div className="mt-3 flex items-center justify-between">
                                                <div className="flex items-center rounded-lg border border-black/10">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                                        className="px-2.5 py-1.5 text-muted transition-colors hover:text-foreground"
                                                        aria-label={`Disminuir cantidad de ${item.product.name}`}
                                                    >
                                                        <Minus className="h-3 w-3" />
                                                    </button>
                                                    <span className="px-3 py-1 text-xs font-semibold">
                                                        {item.quantity}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                                        className="px-2.5 py-1.5 text-muted transition-colors hover:text-foreground"
                                                        aria-label={`Aumentar cantidad de ${item.product.name}`}
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                    </button>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => removeItem(item.product.id)}
                                                    className="p-1 text-muted transition-colors hover:text-danger"
                                                    aria-label={`Eliminar ${item.product.name}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Subtotal */}
                                        <div className="hidden text-right sm:block">
                                            <span className="text-base font-bold">
                                                {formatCOP(item.product.price * item.quantity)}
                                            </span>
                                        </div>
                                    </div>
                                </FadeIn>
                            );
                        })}
                    </div>

                    {/* Summary */}
                    <FadeIn delay={0.15}>
                        <div className="h-fit rounded-2xl border border-black/10 bg-surface p-6 lg:sticky lg:top-32">
                            <h2 className="mb-6 font-heading text-lg font-semibold">
                                Resumen del pedido
                            </h2>

                            <div className="mb-6 space-y-3.5 text-xs sm:text-sm">
                                <div className="flex justify-between text-muted">
                                    <span>Subtotal</span>
                                    <span className="font-medium text-foreground">{formatCOP(subtotal)}</span>
                                </div>
                                {breakdown.discountCop > 0 && (
                                    <div className="flex justify-between text-success">
                                        <span>Descuentos (cupón / puntos)</span>
                                        <span>-{formatCOP(breakdown.discountCop)}</span>
                                    </div>
                                )}
                                {breakdown.legacyItemCount > 0 && (
                                    <div className="flex justify-between text-muted">
                                        <span>Envío nacional</span>
                                        <span className={breakdown.legacyShippingCop === 0 ? "font-semibold text-success" : "text-foreground"}>
                                            {breakdown.legacyShippingCop === 0 ? "Gratis" : formatCOP(breakdown.legacyShippingCop)}
                                        </span>
                                    </div>
                                )}
                                {dsPresent && (
                                    <div className="flex justify-between text-muted">
                                        <span>Envío internacional (estimado)</span>
                                        {breakdown.dsShippingCop === null ? (
                                            <span className="text-warning">Pendiente de cotización</span>
                                        ) : (
                                            <span className="text-foreground">{formatCOP(breakdown.dsShippingCop)}</span>
                                        )}
                                    </div>
                                )}
                                {(() => {
                                    const markdown = items.reduce((sum, item) => {
                                        const original = item.product.originalPrice;
                                        if (typeof original !== "number" || !Number.isFinite(original)) return sum;
                                        if (original <= item.product.price || item.product.price <= 0) return sum;
                                        return sum + (original - item.product.price) * item.quantity;
                                    }, 0);
                                    const totalSavings = markdown + breakdown.discountCop;
                                    return totalSavings > 0 ? (
                                        <div className="flex justify-between font-medium text-accent-dark">
                                            <span>Ahorro total (referencial)</span>
                                            <span>-{formatCOP(totalSavings)}</span>
                                        </div>
                                    ) : null;
                                })()}

                                <div className="flex items-center justify-between border-t border-black/10 pt-4">
                                    <span className="text-base font-bold">Total{total === null ? "" : " estimado"}</span>
                                    {total === null ? (
                                        <span className="text-sm text-warning">Pendiente de cotización</span>
                                    ) : (
                                        <span className="text-2xl font-bold">{formatCOP(total)}</span>
                                    )}
                                </div>
                            </div>

                            <Link
                                href="/checkout"
                                className="motion-press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-semibold text-white transition-colors hover:bg-primary-light"
                            >
                                <span>Continuar al pago</span>
                                <ArrowRight className="h-4 w-4" aria-hidden />
                            </Link>

                            <div className="mt-5 space-y-2 border-t border-black/10 pt-4 text-[11px] text-muted">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                                    <span>Medios disponibles según Wompi al pagar</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Truck className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                                    <span>El envío se confirma antes de completar el pedido</span>
                                </div>
                            </div>

                            <Link
                                href="/products"
                                className="mt-4 block text-center text-xs text-muted transition-colors hover:text-accent-dark"
                            >
                                Continuar explorando productos
                            </Link>
                        </div>
                    </FadeIn>
                </div>

                {/* Upsell */}
                {upsell.length > 0 && (
                    <div className="mt-16">
                        <h2 className="mb-6 font-heading text-2xl font-semibold">
                            También te puede interesar
                        </h2>
                        <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
                            {upsell.map((p) => (
                                <ProductCard key={p.id} product={p} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
