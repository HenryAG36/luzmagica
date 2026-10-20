"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ShieldCheck,
    ShoppingBag,
    Truck,
    Tag,
    X,
    Lock,
    User,
    ArrowRight,
} from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useAuthStore } from "@/store/useAuthStore";
import { formatCOP } from "@/lib/utils";
import { codAttemptId } from "@/lib/cart/codAttempt";
import { shippingQuoteMatchesCity } from "@/lib/cart/shippingQuote";
import FadeIn from "@/components/common/FadeIn";
import ProductImage from "@/components/common/ProductImage";

const emptySubscribe = () => () => {};

export default function CheckoutClient() {
    const searchParams = useSearchParams();
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
    const errorRef = useRef<HTMLDivElement>(null);

    const {
        items,
        customerProfile,
        setCustomerProfile,
        couponCode,
        discountPercent,
        applyCoupon,
        removeCoupon,
        getSubtotal,
        getCouponDiscountCOP,
        getShippingBreakdown,
        getFreeShippingProgress,
    } = useCartStore();

    const { currentUser } = useAuthStore();

    const [couponInput, setCouponInput] = useState("");
    const [couponMessage, setCouponMessage] = useState<{ text: string; error?: boolean } | null>(null);
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    // Server-advertised COD capability (feature flag + API key); null while
    // loading — treated as unavailable so no hidden COD submission happens.
    const [codAvailable, setCodAvailable] = useState<boolean | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<"wompi" | "cash_on_delivery">("wompi");
    // Server-verified Puntos Honesty: balance comes from /api/loyalty/balance
    // and the server re-validates + debits on order creation.
    const [pointsBalance, setPointsBalance] = useState<number | null>(null);
    const [pointsToUse, setPointsToUse] = useState(0);

    const recoverParam = searchParams.get("recover");

    useEffect(() => {
        if (recoverParam && !couponCode) {
            applyCoupon("VUELVE10");
        }
    }, [recoverParam, couponCode, applyCoupon]);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/checkout/payment-methods")
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { cashOnDelivery?: boolean } | null) => {
                if (!cancelled) setCodAvailable(body?.cashOnDelivery === true);
            })
            .catch(() => {
                if (!cancelled) setCodAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!currentUser) return;
        let cancelled = false;
        fetch("/api/loyalty/balance")
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { balance?: { points: number } } | null) => {
                if (!cancelled) setPointsBalance(body?.balance?.points ?? null);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [currentUser]);

    useEffect(() => {
        if (submitError && errorRef.current) {
            errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            errorRef.current.focus();
        }
    }, [submitError]);

    if (!mounted) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-16">
                <div className="animate-pulse text-muted">Cargando checkout...</div>
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
                        <p className="mb-6 text-sm text-muted">
                            Agrega productos del catálogo para continuar.
                        </p>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-4 font-semibold text-white transition-colors hover:bg-primary-light"
                        >
                            Ver catálogo
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const subtotal = getSubtotal();
    const couponDiscount = getCouponDiscountCOP();
    const breakdown = getShippingBreakdown();
    const shippingProgress = getFreeShippingProgress();
    const dsPending = breakdown.dsPending;
    const dsPresent = breakdown.dsItemCount > 0;
    // A confirmed shipping quote is only valid for the city it was quoted for.
    const quotedCities = [
        ...new Set(
            items
                .filter((i) => i.product.shippingQuoteRequired && i.product.shippingEstimateCity)
                .map((i) => i.product.shippingEstimateCity as string)
        ),
    ];
    const quoteCityMismatch = items.some(
        (i) =>
            i.product.shippingQuoteRequired &&
            !shippingQuoteMatchesCity(i.product.shippingEstimateCity, customerProfile.city)
    );

    // Display-side estimate only — the server re-caps against subtotal and
    // the verified balance at order creation.
    const maxRedeemable =
        currentUser && pointsBalance !== null
            ? Math.min(pointsBalance, Math.floor(subtotal / 10))
            : 0;
    const redeemablePoints = Math.min(pointsToUse, maxRedeemable);
    const pointsDiscountCop = redeemablePoints * 10;
    const total = breakdown.total === null ? null : Math.max(0, breakdown.total - pointsDiscountCop);

    // COD is offered only when the server advertises it AND every cart item is
    // Mastershop-sourced (capability flag from the published-products view).
    // Promotions make COD unavailable — they are preserved, never cleared.
    const allCodEligible =
        items.length > 0 && items.every((i) => i.product.cashOnDeliveryEligible === true);
    const promosInUse = couponCode !== null || redeemablePoints > 0;
    const codSelectable = codAvailable === true && allCodEligible;
    const codOptionDisabled = promosInUse;
    // If items/promos changed after selection the truth falls back to Wompi —
    // the radio and the submitted method always agree.
    const effectiveMethod: "wompi" | "cash_on_delivery" =
        codSelectable && !codOptionDisabled ? paymentMethod : "wompi";

    const handleApplyCoupon = (e: React.FormEvent) => {
        e.preventDefault();
        if (!couponInput.trim()) return;
        const result = applyCoupon(couponInput);
        setCouponMessage({ text: result.message, error: !result.success });
        if (result.success) setCouponInput("");
    };

    const handleSubmitOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitError("");
        if (!consent) {
            setSubmitError("Debes aceptar la política de tratamiento de datos para continuar.");
            return;
        }
        if (total === null) {
            setSubmitError("No se pudo confirmar el total del pedido.");
            return;
        }
        if (quoteCityMismatch) {
            setSubmitError(
                "La cotización de envío no corresponde a tu ciudad; solicita confirmación antes de pagar."
            );
            return;
        }
        if (paymentMethod === "cash_on_delivery" && effectiveMethod !== "cash_on_delivery") {
            // Selection became invalid (promos/items changed) — fail visibly.
            setPaymentMethod("wompi");
            setSubmitError("La contraentrega ya no está disponible para este pedido.");
            return;
        }
        setSubmitting(true);
        try {
            // One idempotent attempt id per checkout request — reused across
            // retries (lost responses), fresh when the payload changes. The
            // server rejects a mismatched reuse anyway.
            const attempt =
                effectiveMethod === "cash_on_delivery"
                    ? await codAttemptId({
                          customer: customerProfile,
                          items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
                      })
                    : undefined;
            if (attempt && "error" in attempt) {
                setSubmitError(attempt.error);
                setSubmitting(false);
                return;
            }
            const checkoutAttemptId = attempt?.attemptId;
            const res = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
                    customer: {
                        name: customerProfile.name,
                        email: customerProfile.email,
                        phone: customerProfile.phone,
                        cedula: customerProfile.cedula,
                        address: customerProfile.address,
                        city: customerProfile.city,
                        department: customerProfile.department,
                        notes: customerProfile.notes,
                    },
                    couponCode: effectiveMethod === "cash_on_delivery" ? null : couponCode,
                    consent: true,
                    pointsToRedeem:
                        effectiveMethod === "cash_on_delivery"
                            ? undefined
                            : redeemablePoints > 0
                              ? redeemablePoints
                              : undefined,
                    paymentMethod: effectiveMethod,
                    checkoutAttemptId,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setSubmitError(data.error || "No se pudo crear el pedido. Intenta de nuevo.");
                setSubmitting(false);
                return;
            }
            window.location.href = data.checkoutUrl;
        } catch {
            setSubmitError("Error de red. Verifica tu conexión e intenta de nuevo.");
            setSubmitting(false);
        }
    };

    const inputClass =
        "w-full rounded-xl border border-black/15 bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted transition-colors focus:outline-none focus:border-accent/60";
    const labelClass = "mb-1 block text-xs font-medium text-muted";

    const orderLines = (
        <div className="mb-5 max-h-52 space-y-3 overflow-y-auto pr-1">
            {items.map((item) => (
                <div key={item.product.id} className="flex items-center gap-2.5 text-xs">
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-surface-light">
                        <ProductImage
                            src={item.product.images[0]}
                            alt=""
                            sizes="40px"
                        />
                    </span>
                    <span className="mr-2 flex-1 line-clamp-2 text-muted">
                        {item.product.name} × {item.quantity}
                    </span>
                    <span className="shrink-0 font-medium text-foreground">
                        {formatCOP(item.product.price * item.quantity)}
                    </span>
                </div>
            ))}
        </div>
    );

    const totalsBlock = (
        <div className="mb-5 space-y-2.5 border-t border-black/10 pt-4 text-xs">
            <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span className="text-foreground">{formatCOP(subtotal)}</span>
            </div>
            {couponDiscount > 0 && (
                <div className="flex justify-between text-success">
                    <span>Descuento cupón ({couponCode})</span>
                    <span>-{formatCOP(couponDiscount)}</span>
                </div>
            )}
            {pointsDiscountCop > 0 && (
                <div className="flex justify-between text-success">
                    <span>Puntos Honesty ({redeemablePoints} pts)</span>
                    <span>-{formatCOP(pointsDiscountCop)}</span>
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
                    <span>Envío cotizado (estimado, por unidad)</span>
                    {breakdown.dsShippingCop === null ? (
                        <span className="text-warning">Pendiente de cotización</span>
                    ) : (
                        <span className="text-foreground">{formatCOP(breakdown.dsShippingCop)}</span>
                    )}
                </div>
            )}
            <div className="flex justify-between border-t border-black/10 pt-2 text-base font-bold">
                <span>{dsPresent ? "Total estimado" : "Total a pagar"}</span>
                {total === null ? (
                    <span className="text-sm font-medium text-warning">Pendiente de cotización</span>
                ) : (
                    <span>{formatCOP(total)}</span>
                )}
            </div>
        </div>
    );

    return (
        <div className="px-4 pb-32 pt-8 lg:pb-16">
            <div className="mx-auto max-w-6xl">
                {/* Step orientation — the Wompi step happens off-site after submit */}
                <nav aria-label="Progreso de compra" className="mb-6 flex items-center gap-2 text-xs text-muted">
                    <Link href="/cart" className="transition-colors hover:text-foreground">Carrito</Link>
                    <ArrowRight className="h-3 w-3" aria-hidden />
                    <span className="font-semibold text-foreground" aria-current="step">Datos</span>
                    <ArrowRight className="h-3 w-3" aria-hidden />
                    <span>{effectiveMethod === "cash_on_delivery" ? "Contraentrega" : "Pago en Wompi"}</span>
                </nav>

                <h1 className="mb-8 font-heading text-3xl font-semibold sm:text-4xl">
                    Finalizar compra
                </h1>

                {/* Top-level error alert */}
                {submitError && (
                    <div
                        ref={errorRef}
                        role="alert"
                        tabIndex={-1}
                        className="mb-6 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger focus:outline-none"
                    >
                        {submitError}
                    </div>
                )}

                {/* Free shipping bar (national eligible items only) */}
                {breakdown.legacyItemCount > 0 && (
                    <div className="mb-6 rounded-2xl border border-black/10 bg-surface p-4">
                        <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 font-medium">
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
                    </div>
                )}
                {dsPresent && (
                    <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-xs text-warning">
                        <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                            Este pedido incluye productos con envío cotizado: el envío se cobra
                            por unidad según la cotización estimada y no participa del envío
                            gratis. El tiempo de entrega depende del destino y la transportadora.
                            {quotedCities.length > 0 && (
                                <>
                                    {" "}
                                    Cotización confirmada para {quotedCities.join(", ")}.
                                </>
                            )}
                            {quoteCityMismatch && (
                                <>
                                    {" "}
                                    La cotización no corresponde a tu ciudad — solicita
                                    confirmación antes de pagar.
                                </>
                            )}
                        </span>
                    </div>
                )}

                {/* Mobile order summary disclosure with total visible */}
                <details className="mb-6 rounded-2xl border border-black/10 bg-surface p-4 lg:hidden">
                    <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">
                        <span className="flex items-center gap-2">
                            <ShoppingBag className="h-4 w-4 text-accent-dark" aria-hidden />
                            Resumen del pedido
                        </span>
                        <span className="font-bold">
                            {total === null ? "Por cotizar" : formatCOP(total)}
                        </span>
                    </summary>
                    <div className="mt-4">
                        {orderLines}
                        {totalsBlock}
                    </div>
                </details>

                <form id="checkout-form" onSubmit={handleSubmitOrder}>
                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                        {/* Left column: Customer info & payment */}
                        <div className="space-y-6 lg:col-span-2">
                            {/* Customer information */}
                            <div className="rounded-2xl border border-black/10 bg-surface p-6 sm:p-8">
                                <h2 className="mb-4 font-heading text-lg font-semibold">
                                    1. Datos de envío y destinatario
                                </h2>

                                {/* Session status banner */}
                                {currentUser ? (
                                    <div className="mb-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs">
                                        <div className="flex items-center gap-2">
                                            <User className="h-4 w-4 text-accent-dark" aria-hidden />
                                            <span>
                                                Sesión activa como <strong>{currentUser.name}</strong>
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mb-4 rounded-xl border border-black/10 bg-surface-light p-3 text-xs">
                                        <p className="font-medium">
                                            Compra como invitado, sin crear una cuenta.
                                        </p>
                                        <p className="mt-1 text-muted">
                                            ¿Tienes cuenta Club Honesty?{" "}
                                            <Link
                                                href="/login?redirect=/checkout"
                                                className="font-semibold text-accent-dark hover:underline"
                                            >
                                                Inicia sesión
                                            </Link>{" "}
                                            para usar tus puntos.
                                        </p>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                        <label htmlFor="checkout-name" className={labelClass}>Nombre completo *</label>
                                        <input
                                            id="checkout-name"
                                            name="name"
                                            type="text"
                                            required
                                            autoComplete="name"
                                            value={customerProfile.name}
                                            onChange={(e) => setCustomerProfile({ name: e.target.value })}
                                            placeholder="Ej: Nombre y apellido"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="checkout-phone" className={labelClass}>Teléfono / WhatsApp *</label>
                                        <input
                                            id="checkout-phone"
                                            name="tel"
                                            type="tel"
                                            required
                                            autoComplete="tel"
                                            value={customerProfile.phone}
                                            onChange={(e) => setCustomerProfile({ phone: e.target.value })}
                                            placeholder="310 456 7890"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="checkout-cedula" className={labelClass}>Cédula / Documento *</label>
                                        <input
                                            id="checkout-cedula"
                                            name="cedula"
                                            type="text"
                                            required
                                            autoComplete="off"
                                            value={customerProfile.cedula}
                                            onChange={(e) => setCustomerProfile({ cedula: e.target.value })}
                                            placeholder="Requerido por transportadora"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label htmlFor="checkout-email" className={labelClass}>Correo para confirmación *</label>
                                        <input
                                            id="checkout-email"
                                            name="email"
                                            type="email"
                                            required
                                            autoComplete="email"
                                            value={customerProfile.email}
                                            onChange={(e) => setCustomerProfile({ email: e.target.value })}
                                            placeholder="tu@correo.com"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label htmlFor="checkout-address" className={labelClass}>Dirección de entrega *</label>
                                        <input
                                            id="checkout-address"
                                            name="street-address"
                                            type="text"
                                            required
                                            autoComplete="street-address"
                                            value={customerProfile.address}
                                            onChange={(e) => setCustomerProfile({ address: e.target.value })}
                                            placeholder="Calle 127 #15-32 Apto 402"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="checkout-city" className={labelClass}>Ciudad *</label>
                                        <input
                                            id="checkout-city"
                                            name="address-level2"
                                            type="text"
                                            required
                                            autoComplete="address-level2"
                                            value={customerProfile.city}
                                            onChange={(e) => setCustomerProfile({ city: e.target.value })}
                                            placeholder="Bogotá, Medellín, Cali…"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="checkout-department" className={labelClass}>Departamento</label>
                                        <input
                                            id="checkout-department"
                                            name="address-level1"
                                            type="text"
                                            autoComplete="address-level1"
                                            value={customerProfile.department || ""}
                                            onChange={(e) => setCustomerProfile({ department: e.target.value })}
                                            placeholder="Cundinamarca, Antioquia…"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label htmlFor="checkout-notes" className={labelClass}>Notas de entrega (opcional)</label>
                                        <input
                                            id="checkout-notes"
                                            name="notes"
                                            type="text"
                                            autoComplete="off"
                                            value={customerProfile.notes || ""}
                                            onChange={(e) => setCustomerProfile({ notes: e.target.value })}
                                            placeholder="Portería, dejar con conserje…"
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Payment via Wompi */}
                            <div className="rounded-2xl border border-black/10 bg-surface p-6 sm:p-8">
                                <h2 className="mb-4 font-heading text-lg font-semibold">
                                    2. Pago y consentimiento
                                </h2>

                                <div className="mb-5 rounded-2xl border border-black/10 bg-surface-light p-4">
                                    <div className="mb-2 flex items-center gap-3">
                                        <ShieldCheck className="h-5 w-5 shrink-0 text-accent-dark" aria-hidden />
                                        <span className="text-sm font-bold">
                                            {effectiveMethod === "cash_on_delivery"
                                                ? "Pago contraentrega"
                                                : "Pago procesado por Wompi"}
                                        </span>
                                    </div>
                                    <div role="radiogroup" aria-label="Método de pago" className="space-y-2">
                                        <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                                            <input
                                                type="radio"
                                                name="payment-method"
                                                checked={effectiveMethod === "wompi"}
                                                onChange={() => setPaymentMethod("wompi")}
                                                className="mt-0.5 h-3.5 w-3.5 accent-foreground"
                                            />
                                            <span>
                                                <span className="font-semibold">Pago en línea (Wompi)</span>
                                                <span className="block text-[11px] text-muted">
                                                    Serás redirigido a la página segura de Wompi para elegir
                                                    tu método de pago.
                                                </span>
                                            </span>
                                        </label>
                                        {codSelectable && (
                                            <label
                                                className={`flex items-start gap-2.5 text-xs ${codOptionDisabled ? "opacity-60" : "cursor-pointer"}`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="payment-method"
                                                    checked={effectiveMethod === "cash_on_delivery"}
                                                    disabled={codOptionDisabled}
                                                    onChange={() => setPaymentMethod("cash_on_delivery")}
                                                    className="mt-0.5 h-3.5 w-3.5 accent-foreground"
                                                />
                                                <span>
                                                    <span className="font-semibold">Contraentrega</span>
                                                    <span className="block text-[11px] text-muted">
                                                        Paga al recibir. El pedido queda sujeto a confirmación
                                                        de cobertura y despacho. No admite cupones ni puntos y
                                                        requiere cédula de ciudadanía (CC).
                                                    </span>
                                                    {codOptionDisabled && (
                                                        <span className="block text-[11px] font-medium text-warning">
                                                            Cupones y puntos disponibles con pago en línea.
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                </div>

                                {/* Coupon disclosure */}
                                <details className="mb-5 rounded-xl border border-black/10 bg-surface-light px-4 py-3">
                                    <summary className="cursor-pointer text-xs font-semibold">
                                        ¿Tienes un cupón?
                                    </summary>
                                    <div className="mt-3">
                                        {couponCode ? (
                                            <div className="flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 p-2.5 text-xs">
                                                <div className="flex items-center gap-2">
                                                    <Tag className="h-3.5 w-3.5 text-accent-dark" aria-hidden />
                                                    <span className="font-mono font-bold text-accent-dark">{couponCode}</span>
                                                    <span>(-{discountPercent}%)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={removeCoupon}
                                                    className="text-muted transition-colors hover:text-foreground"
                                                    aria-label="Quitar cupón"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <label htmlFor="coupon-input" className="sr-only">Código de cupón</label>
                                                <input
                                                    id="coupon-input"
                                                    type="text"
                                                    value={couponInput}
                                                    onChange={(e) => setCouponInput(e.target.value)}
                                                    placeholder="Ej: HONEST10"
                                                    className="flex-1 rounded-xl border border-black/15 bg-surface px-3 py-2 text-xs uppercase placeholder:text-muted focus:outline-none focus:border-accent/60"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleApplyCoupon}
                                                    className="rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-light"
                                                >
                                                    Aplicar
                                                </button>
                                            </div>
                                        )}
                                        {couponMessage && (
                                            <p
                                                role={couponMessage.error ? "alert" : "status"}
                                                className={`mt-1.5 text-[11px] ${couponMessage.error ? "text-danger" : "text-success"}`}
                                            >
                                                {couponMessage.text}
                                            </p>
                                        )}
                                    </div>
                                </details>

                                {/* Puntos Honesty redemption (server-verified balance, shared all widths) */}
                                {currentUser && pointsBalance !== null && pointsBalance > 0 && (
                                    <div className="mb-5 rounded-xl border border-black/10 bg-surface-light p-3">
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="font-semibold">Puntos Honesty</span>
                                            <span className="text-muted">
                                                Saldo verificado: <span className="font-bold text-accent-dark">{pointsBalance} pts</span>
                                            </span>
                                        </div>
                                        {maxRedeemable === 0 ? (
                                            <p className="text-[11px] text-muted">
                                                Este pedido no permite canje (subtotal insuficiente).
                                            </p>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <label htmlFor="points-input" className="sr-only">Puntos a canjear</label>
                                                <input
                                                    id="points-input"
                                                    type="number"
                                                    min={0}
                                                    max={maxRedeemable}
                                                    step={1}
                                                    value={pointsToUse}
                                                    onChange={(e) =>
                                                        setPointsToUse(
                                                            Math.max(
                                                                0,
                                                                Math.min(maxRedeemable, Math.floor(Number(e.target.value) || 0)),
                                                            ),
                                                        )
                                                    }
                                                    className="w-24 rounded-xl border border-black/15 bg-surface px-3 py-2 text-xs focus:outline-none focus:border-accent/60"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setPointsToUse(maxRedeemable)}
                                                    className="rounded-xl border border-black/15 px-3 py-2 text-[11px] font-semibold transition-colors hover:bg-black/5"
                                                >
                                                    Usar {maxRedeemable}
                                                </button>
                                                <span className="text-[11px] text-muted">= {formatCOP(pointsDiscountCop)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <label htmlFor="checkout-consent" className="flex cursor-pointer items-start gap-3 select-none">
                                    <input
                                        id="checkout-consent"
                                        type="checkbox"
                                        checked={consent}
                                        onChange={(e) => setConsent(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 accent-foreground"
                                    />
                                    <span className="text-xs leading-relaxed text-muted">
                                        Acepto la{" "}
                                        <Link href="/legal/privacidad" className="text-accent-dark hover:underline" target="_blank">
                                            política de tratamiento de datos personales
                                        </Link>{" "}
                                        (Ley 1581 de 2012). Mis datos serán usados para procesar y
                                        entregar este pedido.
                                    </span>
                                </label>
                            </div>
                        </div>

                        {/* Right column: Summary */}
                        <div className="hidden lg:block">
                            <div className="sticky top-32 rounded-2xl border border-black/10 bg-surface p-6">
                                <h2 className="mb-4 font-heading text-lg font-semibold">
                                    Resumen del pedido
                                </h2>

                                {orderLines}

                                {totalsBlock}

                                {dsPending && (
                                    <p role="alert" className="mb-3 text-[11px] font-medium text-warning">
                                        No se puede completar el pedido: falta la cotización de envío
                                        del proveedor.
                                    </p>
                                )}
                                {quoteCityMismatch && !dsPending && (
                                    <p role="alert" className="mb-3 text-[11px] font-medium text-warning">
                                        No se puede completar el pedido: la cotización de envío no
                                        corresponde a la ciudad indicada.
                                    </p>
                                )}
                                <button
                                    type="submit"
                                    disabled={submitting || dsPending || quoteCityMismatch || total === null}
                                    className="motion-press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-black/30"
                                >
                                    <Lock className="h-4 w-4" aria-hidden />
                                    <span>
                                        {submitting
                                            ? "Creando pedido…"
                                            : total === null
                                              ? effectiveMethod === "cash_on_delivery"
                                                  ? "Confirmar pedido contraentrega"
                                                  : "Continuar a Wompi"
                                              : effectiveMethod === "cash_on_delivery"
                                                ? `Confirmar pedido contraentrega · ${formatCOP(total)}`
                                                : `Continuar a Wompi · ${formatCOP(total)}`}
                                    </span>
                                </button>
                                <p className="mt-3 text-center text-[10px] text-muted">
                                    {effectiveMethod === "cash_on_delivery"
                                        ? "Paga al recibir. El pedido queda sujeto a confirmación de cobertura y despacho."
                                        : "Serás redirigido a Wompi para elegir tu método de pago."}
                                </p>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            {/* Mobile sticky CTA */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
                <div className="mx-auto flex max-w-6xl items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted">{dsPresent ? "Total estimado" : "Total a pagar"}</p>
                        <p className="text-base font-bold">
                            {total === null ? "Por cotizar" : formatCOP(total)}
                        </p>
                    </div>
                    <button
                        type="submit"
                        form="checkout-form"
                        disabled={submitting || dsPending || total === null}
                        className="motion-press flex shrink-0 items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-black/30"
                    >
                        <ArrowRight className="h-4 w-4" aria-hidden />
                        {submitting
                            ? "Creando pedido…"
                            : effectiveMethod === "cash_on_delivery"
                              ? "Confirmar contraentrega"
                              : "Continuar a Wompi"}
                    </button>
                </div>
            </div>
        </div>
    );
}
