"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Minus, Plus, Trash2, Truck, Lock } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import ProductImage from "@/components/common/ProductImage";
import { formatCOP } from "@/lib/utils";

export default function CartDrawer() {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    const {
        items,
        isCartOpen,
        closeCart,
        updateQuantity,
        removeItem,
        couponCode,
        discountPercent,
        getSubtotal,
        getCouponDiscountCOP,
        getShippingBreakdown,
        getFreeShippingProgress,
    } = useCartStore();

    const pathname = usePathname();

    // Cart contents live in localStorage — render nothing until mounted so
    // SSR output matches the client's first render.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Close whenever the route changes.
    useEffect(() => {
        if (isCartOpen) closeCart();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // Sync the native dialog with store state.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (isCartOpen) {
            restoreFocusRef.current = document.activeElement as HTMLElement | null;
            if (!dialog.open) dialog.showModal();
            document.body.style.overflow = "hidden";
            closeButtonRef.current?.focus();
        } else {
            if (dialog.open) dialog.close();
            document.body.style.overflow = "";
            restoreFocusRef.current?.focus?.();
            restoreFocusRef.current = null;
        }

        return () => {
            document.body.style.overflow = "";
        };
    }, [isCartOpen, mounted]);

    const subtotal = getSubtotal();
    const couponDiscount = getCouponDiscountCOP();
    const breakdown = getShippingBreakdown();
    const total = breakdown.total;
    const shippingProgress = getFreeShippingProgress();

    const itemSavings = items.reduce((sum, item) => {
        const original = item.product.originalPrice;
        if (typeof original !== "number" || !Number.isFinite(original)) return sum;
        if (original <= item.product.price || item.product.price <= 0) return sum;
        return sum + (original - item.product.price) * item.quantity;
    }, 0);
    const totalSavings = itemSavings + couponDiscount;

    const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
        if (e.target === dialogRef.current) closeCart();
    };

    if (!mounted) return null;

    return (
        <dialog
            ref={dialogRef}
            aria-label="Carrito de compras"
            onCancel={() => closeCart()}
            onClose={() => closeCart()}
            onClick={handleBackdropClick}
            className="cart-drawer m-0 ml-auto h-dvh max-h-none w-full max-w-md border-0 bg-surface p-0 text-foreground shadow-2xl"
        >
            <div className="flex h-full flex-col">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
                    <h2 className="font-heading text-2xl font-semibold">
                        Tu carrito{" "}
                        <span className="text-base font-normal text-muted">
                            ({items.reduce((n, i) => n + i.quantity, 0)})
                        </span>
                    </h2>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={closeCart}
                        aria-label="Cerrar carrito"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-black/5 hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Free shipping progress (national items only) */}
                {breakdown.legacyItemCount > 0 && (
                    <div className="border-b border-black/10 px-5 py-3">
                        <p className="mb-1.5 text-xs text-muted">
                            {shippingProgress.isFree
                                ? "Tu pedido incluye envío nacional gratis"
                                : `Agrega ${formatCOP(shippingProgress.remaining)} más en productos nacionales para envío gratis`}
                        </p>
                        <div
                            className="h-1.5 w-full rounded-full bg-black/10"
                            role="progressbar"
                            aria-valuenow={shippingProgress.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Progreso hacia envío gratis"
                        >
                            <div
                                className="motion-progress h-full rounded-full bg-foreground"
                                style={{ width: `${Math.min(100, shippingProgress.percent)}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Items */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {items.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                            <Truck className="h-10 w-10 text-muted" aria-hidden />
                            <p className="text-sm text-muted">Tu carrito está vacío.</p>
                            <button
                                type="button"
                                onClick={closeCart}
                                className="rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light"
                            >
                                Seguir comprando
                            </button>
                        </div>
                    ) : (
                        <ul className="space-y-4">
                            {items.map((item) => (
                                <li key={item.product.id} className="flex gap-3">
                                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-black/10">
                                        <ProductImage
                                            src={item.product.images[0]}
                                            alt={item.product.name}
                                            sizes="80px"
                                        />
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="truncate text-sm font-medium">{item.product.name}</p>
                                            <button
                                                type="button"
                                                onClick={() => removeItem(item.product.id)}
                                                aria-label={`Eliminar ${item.product.name}`}
                                                className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-black/5 hover:text-danger"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted">
                                            {formatCOP(item.product.price)} c/u
                                        </p>
                                        <div className="mt-auto flex items-center justify-between pt-2">
                                            <div className="flex items-center rounded-full border border-black/10">
                                                <button
                                                    type="button"
                                                    aria-label="Disminuir cantidad"
                                                    onClick={() =>
                                                        updateQuantity(item.product.id, item.quantity - 1)
                                                    }
                                                    className="motion-press p-1.5 text-muted transition-colors hover:text-foreground"
                                                >
                                                    <Minus className="h-3.5 w-3.5" />
                                                </button>
                                                <span key={item.quantity} className="motion-count w-7 text-center text-xs font-semibold" aria-live="polite">
                                                    {item.quantity}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label="Aumentar cantidad"
                                                    onClick={() =>
                                                        updateQuantity(item.product.id, item.quantity + 1)
                                                    }
                                                    className="motion-press p-1.5 text-muted transition-colors hover:text-foreground"
                                                >
                                                    <Plus className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                            <span className="text-sm font-semibold">
                                                {formatCOP(item.product.price * item.quantity)}
                                            </span>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Summary + CTAs */}
                {items.length > 0 && (
                    <div className="border-t border-black/10 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                        <dl className="space-y-1.5 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-muted">Subtotal</dt>
                                <dd>{formatCOP(subtotal)}</dd>
                            </div>
                            {couponDiscount > 0 && (
                                <div className="flex justify-between text-success">
                                    <dt>Cupón {couponCode} ({discountPercent}%)</dt>
                                    <dd>-{formatCOP(couponDiscount)}</dd>
                                </div>
                            )}
                            {breakdown.legacyItemCount > 0 && (
                                <div className="flex justify-between">
                                    <dt className="text-muted">Envío nacional</dt>
                                    <dd>
                                        {breakdown.legacyShippingCop === 0
                                            ? "Gratis"
                                            : formatCOP(breakdown.legacyShippingCop)}
                                    </dd>
                                </div>
                            )}
                            {breakdown.dsItemCount > 0 && (
                                <div className="flex justify-between">
                                    <dt className="text-muted">Envío internacional</dt>
                                    <dd>
                                        {breakdown.dsShippingCop === null ? (
                                            <span className="text-warning">Pendiente de cotización</span>
                                        ) : (
                                            formatCOP(breakdown.dsShippingCop)
                                        )}
                                    </dd>
                                </div>
                            )}
                            {totalSavings > 0 && (
                                <div className="flex justify-between font-medium text-accent-dark">
                                    <dt>Ahorro total</dt>
                                    <dd>-{formatCOP(totalSavings)}</dd>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-black/10 pt-2 text-base font-bold">
                                <dt>Total{breakdown.dsItemCount > 0 ? " (estimado)" : ""}</dt>
                                <dd>
                                    {total === null ? (
                                        <span className="text-sm font-medium text-warning">
                                            Pendiente de cotización de envío
                                        </span>
                                    ) : (
                                        formatCOP(total)
                                    )}
                                </dd>
                            </div>
                        </dl>

                        <div className="mt-4 space-y-2">
                            {total === null ? (
                                <p className="text-center text-xs text-warning">
                                    El envío internacional debe cotizarse antes de pagar.
                                </p>
                            ) : (
                                <Link
                                    href="/checkout"
                                    onClick={closeCart}
                                    className="motion-press flex items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light"
                                >
                                    <Lock className="h-4 w-4" />
                                    Ir a pagar
                                </Link>
                            )}
                            <div className="flex gap-2">
                                <Link
                                    href="/cart"
                                    onClick={closeCart}
                                    className="flex-1 rounded-full border border-black/15 py-2.5 text-center text-xs font-semibold transition-colors hover:bg-black/5"
                                >
                                    Ver carrito
                                </Link>
                                <button
                                    type="button"
                                    onClick={closeCart}
                                    className="flex-1 rounded-full border border-black/15 py-2.5 text-xs font-semibold transition-colors hover:bg-black/5"
                                >
                                    Seguir comprando
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </dialog>
    );
}
