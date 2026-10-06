"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ShieldCheck,
    ArrowLeft,
    ShoppingBag,
    Sparkles,
    Truck,
    CreditCard,
    Smartphone,
    Building2,
    Tag,
    X,
    Lock,
    User,
    ArrowRight,
} from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { useAuthStore } from "@/store/useAuthStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";

const emptySubscribe = () => () => {};

export default function CheckoutClient() {
    const searchParams = useSearchParams();
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

    const {
        items,
        customerProfile,
        setCustomerProfile,
        couponCode,
        discountPercent,
        applyCoupon,
        removeCoupon,
        pointsRedeemed,
        setPointsRedeemed,
        getSubtotal,
        getCouponDiscountCOP,
        getPointsDiscountCOP,
        getShippingBreakdown,
        getFreeShippingProgress,
    } = useCartStore();

    const { account } = useLoyaltyStore();
    const { currentUser } = useAuthStore();

    const [couponInput, setCouponInput] = useState("");
    const [couponMessage, setCouponMessage] = useState<{ text: string; error?: boolean } | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<
        "nequi" | "pse" | "bancolombia" | "credit_card" | "contraentrega"
    >("nequi");

    const recoverParam = searchParams.get("recover");

    useEffect(() => {
        if (recoverParam && !couponCode) {
            applyCoupon("RETORNO10");
        }
    }, [recoverParam, couponCode, applyCoupon]);

    if (!mounted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando checkout seguro...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="text-center max-w-md mx-auto">
                        <ShoppingBag className="w-16 h-16 text-muted mx-auto mb-6" />
                        <h1 className="font-heading text-3xl font-bold text-white mb-3">
                            No hay items en el carrito
                        </h1>
                        <p className="text-muted text-sm mb-6">
                            Agrega productos mágicos de iluminación LED para continuar.
                        </p>
                        <Link
                            href="/products"
                            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all"
                        >
                            Explorar Iluminación
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const subtotal = getSubtotal();
    const couponDiscount = getCouponDiscountCOP();
    const pointsDiscount = getPointsDiscountCOP();
    const breakdown = getShippingBreakdown();
    const total = breakdown.total;
    const shippingProgress = getFreeShippingProgress();
    const dsPending = breakdown.dsPending;
    const dsPresent = breakdown.dsItemCount > 0;
    const cityIsBogota = /^\s*bogot/i.test(customerProfile.city || "");

    const handleApplyCoupon = (e: React.FormEvent) => {
        e.preventDefault();
        if (!couponInput.trim()) return;
        const result = applyCoupon(couponInput);
        setCouponMessage({ text: result.message, error: !result.success });
        if (result.success) setCouponInput("");
    };

    const handlePointsToggle = (pts: number) => {
        if (pointsRedeemed === pts) {
            setPointsRedeemed(0);
        } else {
            // Check max points permitted (cannot exceed subtotal)
            const maxPointsForSubtotal = Math.floor(subtotal / 10);
            const actual = Math.min(pts, account.points, maxPointsForSubtotal);
            setPointsRedeemed(actual);
        }
    };

    // Purchases are disabled until a real payment/order pipeline is connected.
    // Submitting must not create orders, award points, or simulate fulfillment.
    const handleSubmitOrder = (e: React.FormEvent) => {
        e.preventDefault();
    };

    const inputClass =
        "w-full px-4 py-3 rounded-xl bg-surface border border-white/10 text-white placeholder-muted focus:outline-none focus:border-primary transition-colors text-sm";

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-6xl mx-auto">
                <FadeIn>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <div>
                            <Link
                                href="/cart"
                                className="inline-flex items-center gap-2 text-xs text-muted hover:text-white transition-colors mb-2"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Volver al carrito
                            </Link>
                            <h1 className="font-heading text-3xl sm:text-4xl font-bold">
                                <span className="gradient-text">Checkout Seguro</span>
                            </h1>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-card border border-white/10 text-xs text-muted">
                            <Lock className="w-3.5 h-3.5 text-green-400" />
                            <span>Encriptación SSL 256-bit</span>
                        </div>
                    </div>

                    {/* Free shipping bar (legacy national items only; DS products ship per quoted estimate) */}
                    {(!dsPresent || breakdown.legacyItemCount > 0) && (
                        <div className="p-4 rounded-2xl bg-surface-card border border-white/10 mb-8">
                            <div className="flex items-center justify-between text-xs mb-2">
                                <span className="flex items-center gap-2 text-white font-medium">
                                    <Truck className="w-4 h-4 text-primary" />
                                    {shippingProgress.isFree
                                        ? "¡Felicidades! Tienes Envío Gratis Nacional"
                                        : `Agrega ${formatCOP(shippingProgress.remaining)} para obtener Envío Gratis en toda Colombia`}
                                    {dsPresent && " (solo productos nacionales)"}
                                </span>
                                <span className="text-muted font-mono">{shippingProgress.percent}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                                    style={{ width: `${shippingProgress.percent}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {dsPresent && (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 mb-8 text-xs text-amber-200 flex items-start gap-2.5">
                            <Truck className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                            <span>
                                Este pedido incluye productos de proveedor internacional: el envío se cobra por unidad
                                según la cotización estimada a Bogotá y no participa del envío gratis. Pedido estimado:
                                no hay fulfillment automático ni verificación de destino{cityIsBogota ? "" : " — la cotización es a Bogotá y no está confirmada para tu ciudad"}.
                            </span>
                        </div>
                    )}
                </FadeIn>

                <form onSubmit={handleSubmitOrder}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left column: Customer info & payment */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Customer information (Auto-fills and remembers for 1-click repeat) */}
                            <FadeIn delay={0.1}>
                                <div className="glass rounded-2xl p-6 sm:p-8">
                                    <div className="flex items-center justify-between mb-6">
                                        <h2 className="font-heading text-lg font-bold text-white flex items-center gap-2">
                                            <span>1. Datos de Envío & Destinatario</span>
                                        </h2>
                                        <span className="text-[11px] text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                                            Perfil Guardado
                                        </span>
                                    </div>

                                    {/* Session status banner */}
                                    {currentUser ? (
                                        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between text-xs mb-4">
                                            <div className="flex items-center gap-2">
                                                <User className="w-4 h-4 text-primary" />
                                                <span className="text-white">
                                                    Sesión activa como <strong>{currentUser.name}</strong>
                                                </span>
                                            </div>
                                            <span className="text-[11px] text-accent font-semibold">
                                                Datos vinculados
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs mb-4">
                                            <span className="text-muted">¿Tienes cuenta LuzClub?</span>
                                            <Link
                                                href="/login?redirect=/checkout"
                                                className="text-primary hover:underline font-semibold flex items-center gap-1"
                                            >
                                                <span>Iniciar Sesión</span>
                                                <ArrowRight className="w-3 h-3" />
                                            </Link>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="sm:col-span-2">
                                            <label className="text-xs text-muted mb-1 block">Nombre completo *</label>
                                            <input
                                                type="text"
                                                required
                                                value={customerProfile.name}
                                                onChange={(e) => setCustomerProfile({ name: e.target.value })}
                                                placeholder="Ej: Nombre y apellido"
                                                className={inputClass}
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Teléfono / WhatsApp *</label>
                                            <input
                                                type="tel"
                                                required
                                                value={customerProfile.phone}
                                                onChange={(e) => setCustomerProfile({ phone: e.target.value })}
                                                placeholder="310 456 7890"
                                                className={inputClass}
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Cédula / Documento *</label>
                                            <input
                                                type="text"
                                                required
                                                value={customerProfile.cedula}
                                                onChange={(e) => setCustomerProfile({ cedula: e.target.value })}
                                                placeholder="Requerido por transportadora"
                                                className={inputClass}
                                            />
                                        </div>

                                        <div className="sm:col-span-2">
                                            <label className="text-xs text-muted mb-1 block">Email para confirmación *</label>
                                            <input
                                                type="email"
                                                required
                                                value={customerProfile.email}
                                                onChange={(e) => setCustomerProfile({ email: e.target.value })}
                                                placeholder="tu@correo.com"
                                                className={inputClass}
                                            />
                                        </div>

                                        <div className="sm:col-span-2">
                                            <label className="text-xs text-muted mb-1 block">Dirección de entrega *</label>
                                            <input
                                                type="text"
                                                required
                                                value={customerProfile.address}
                                                onChange={(e) => setCustomerProfile({ address: e.target.value })}
                                                placeholder="Calle 127 #15-32 Apto 402"
                                                className={inputClass}
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Ciudad *</label>
                                            <input
                                                type="text"
                                                required
                                                value={customerProfile.city}
                                                onChange={(e) => setCustomerProfile({ city: e.target.value })}
                                                placeholder="Bogotá, Medellín, Cali..."
                                                className={inputClass}
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Notas de entrega (opcional)</label>
                                            <input
                                                type="text"
                                                value={customerProfile.notes || ""}
                                                onChange={(e) => setCustomerProfile({ notes: e.target.value })}
                                                placeholder="Portería, dejar con conserje..."
                                                className={inputClass}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </FadeIn>

                            {/* Payment Methods */}
                            <FadeIn delay={0.2}>
                                <div className="glass rounded-2xl p-6 sm:p-8">
                                    <h2 className="font-heading text-lg font-bold text-white mb-4">
                                        2. Método de Pago Seguro
                                    </h2>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                        {/* Nequi */}
                                        <label
                                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                                                paymentMethod === "nequi"
                                                    ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                                                    : "border-white/10 bg-surface hover:border-white/20"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="radio"
                                                    name="payment"
                                                    checked={paymentMethod === "nequi"}
                                                    onChange={() => setPaymentMethod("nequi")}
                                                    className="accent-primary"
                                                />
                                                <div>
                                                    <span className="font-bold text-sm text-white block">Nequi</span>
                                                    <span className="text-[11px] text-muted">Pago inmediato con celular</span>
                                                </div>
                                            </div>
                                            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">
                                                Popular
                                            </span>
                                        </label>

                                        {/* PSE */}
                                        <label
                                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                                                paymentMethod === "pse"
                                                    ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                                                    : "border-white/10 bg-surface hover:border-white/20"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="radio"
                                                    name="payment"
                                                    checked={paymentMethod === "pse"}
                                                    onChange={() => setPaymentMethod("pse")}
                                                    className="accent-primary"
                                                />
                                                <div>
                                                    <span className="font-bold text-sm text-white block">PSE</span>
                                                    <span className="text-[11px] text-muted">Todos los bancos de Colombia</span>
                                                </div>
                                            </div>
                                            <Building2 className="w-5 h-5 text-muted" />
                                        </label>

                                        {/* Bancolombia */}
                                        <label
                                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                                                paymentMethod === "bancolombia"
                                                    ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                                                    : "border-white/10 bg-surface hover:border-white/20"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="radio"
                                                    name="payment"
                                                    checked={paymentMethod === "bancolombia"}
                                                    onChange={() => setPaymentMethod("bancolombia")}
                                                    className="accent-primary"
                                                />
                                                <div>
                                                    <span className="font-bold text-sm text-white block">Bancolombia</span>
                                                    <span className="text-[11px] text-muted">Transferencia directa</span>
                                                </div>
                                            </div>
                                            <Smartphone className="w-5 h-5 text-muted" />
                                        </label>

                                        {/* Credit Card */}
                                        <label
                                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                                                paymentMethod === "credit_card"
                                                    ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                                                    : "border-white/10 bg-surface hover:border-white/20"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="radio"
                                                    name="payment"
                                                    checked={paymentMethod === "credit_card"}
                                                    onChange={() => setPaymentMethod("credit_card")}
                                                    className="accent-primary"
                                                />
                                                <div>
                                                    <span className="font-bold text-sm text-white block">Tarjeta Débito/Crédito</span>
                                                    <span className="text-[11px] text-muted">Visa, Mastercard, AMEX</span>
                                                </div>
                                            </div>
                                            <CreditCard className="w-5 h-5 text-muted" />
                                        </label>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-surface border border-white/5 flex items-center gap-3 text-xs text-muted">
                                        <ShieldCheck className="w-5 h-5 text-secondary shrink-0" />
                                        <span>
                                            Los métodos de pago se habilitarán cuando la pasarela de pagos esté conectada.
                                        </span>
                                    </div>
                                </div>
                            </FadeIn>
                        </div>

                        {/* Right column: Summary, Loyalty Points, Coupons */}
                        <div className="space-y-6">
                            <FadeIn delay={0.2}>
                                <div className="glass rounded-2xl p-6 sticky top-28">
                                    <h2 className="font-heading text-lg font-bold text-white mb-4">
                                        Resumen del Pedido
                                    </h2>

                                    {/* Items List */}
                                    <div className="space-y-3 mb-5 max-h-52 overflow-y-auto pr-1">
                                        {items.map((item) => (
                                            <div key={item.product.id} className="flex justify-between text-xs">
                                                <span className="text-muted line-clamp-1 flex-1 mr-2">
                                                    {item.product.name} × {item.quantity}
                                                </span>
                                                <span className="text-white font-medium shrink-0">
                                                    {formatCOP(item.product.price * item.quantity)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Loyalty Points Redemption Box */}
                                    {account.points > 0 && (
                                        <div className="p-4 rounded-xl bg-surface-card border border-primary/20 mb-5">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                                    Canjear LuzClub ({account.points} pts)
                                                </span>
                                                <span className="text-[11px] text-green-400 font-bold">
                                                    {formatCOP(account.points * 10)}
                                                </span>
                                            </div>
                                            <div className="flex gap-2">
                                                {[100, 200, 350].map((pts) => {
                                                    if (pts > account.points) return null;
                                                    const isSelected = pointsRedeemed === pts;
                                                    return (
                                                        <button
                                                            key={pts}
                                                            type="button"
                                                            onClick={() => handlePointsToggle(pts)}
                                                            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all ${
                                                                isSelected
                                                                    ? "bg-primary text-white border-primary"
                                                                    : "bg-surface text-muted border-white/10 hover:border-white/20"
                                                            }`}
                                                        >
                                                            {pts} pts (-{formatCOP(pts * 10)})
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Coupon input */}
                                    <div className="mb-5">
                                        {couponCode ? (
                                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-accent/10 border border-accent/30 text-xs">
                                                <div className="flex items-center gap-2">
                                                    <Tag className="w-3.5 h-3.5 text-accent" />
                                                    <span className="font-mono font-bold text-accent">{couponCode}</span>
                                                    <span className="text-white">(-{discountPercent}%)</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={removeCoupon}
                                                    className="text-muted hover:text-white"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={couponInput}
                                                    onChange={(e) => setCouponInput(e.target.value)}
                                                    placeholder="Cupón (ej: MAGIA10)"
                                                    className="flex-1 px-3 py-2 rounded-xl bg-surface border border-white/10 text-xs text-white uppercase placeholder-muted focus:outline-none focus:border-primary"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleApplyCoupon}
                                                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
                                                >
                                                    Aplicar
                                                </button>
                                            </div>
                                        )}
                                        {couponMessage && (
                                            <p
                                                className={`text-[11px] mt-1.5 ${
                                                    couponMessage.error ? "text-red-400" : "text-green-400"
                                                }`}
                                            >
                                                {couponMessage.text}
                                            </p>
                                        )}
                                    </div>

                                    {/* Financial Breakdown */}
                                    <div className="space-y-2.5 border-t border-white/10 pt-4 mb-5 text-xs">
                                        <div className="flex justify-between text-muted">
                                            <span>Subtotal</span>
                                            <span className="text-white">{formatCOP(subtotal)}</span>
                                        </div>

                                        {couponDiscount > 0 && (
                                            <div className="flex justify-between text-green-400">
                                                <span>Descuento cupón ({couponCode})</span>
                                                <span>-{formatCOP(couponDiscount)}</span>
                                            </div>
                                        )}

                                        {pointsDiscount > 0 && (
                                            <div className="flex justify-between text-green-400">
                                                <span>Canje LuzPoints ({pointsRedeemed} pts)</span>
                                                <span>-{formatCOP(pointsDiscount)}</span>
                                            </div>
                                        )}

                                        {breakdown.legacyItemCount > 0 && (
                                            <div className="flex justify-between text-muted">
                                                <span>Envío Nacional (productos locales)</span>
                                                <span className={breakdown.legacyShippingCop === 0 ? "text-secondary font-semibold" : "text-white"}>
                                                    {breakdown.legacyShippingCop === 0 ? "¡Gratis!" : formatCOP(breakdown.legacyShippingCop)}
                                                </span>
                                            </div>
                                        )}

                                        {dsPresent && (
                                            <div className="flex justify-between text-muted">
                                                <span>Envío internacional (estimado, por unidad, a Bogotá)</span>
                                                {breakdown.dsShippingCop === null ? (
                                                    <span className="text-amber-300">Pendiente de cotización</span>
                                                ) : (
                                                    <span className="text-white">{formatCOP(breakdown.dsShippingCop)}</span>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex justify-between text-base font-bold text-white pt-2 border-t border-white/10">
                                            <span>Total a Pagar</span>
                                            {total === null ? (
                                                <span className="text-amber-300 text-sm">Pendiente de cotización de envío</span>
                                            ) : (
                                                <span className="gradient-text">{formatCOP(total)}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Submit Button */}
                                    {dsPending && (
                                        <p role="alert" className="text-[11px] text-amber-300 mb-3">
                                            No se puede completar el pedido: falta la cotización de envío del proveedor internacional.
                                        </p>
                                    )}
                                    <p role="alert" className="text-[11px] text-amber-300 mb-3">
                                        Compras aún no disponibles; estamos configurando pagos y pedidos.
                                    </p>
                                    <button
                                        type="submit"
                                        disabled
                                        className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold glow-purple transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                                    >
                                        <Lock className="w-4 h-4" />
                                        <span>Pagos en configuración</span>
                                    </button>
                                </div>
                            </FadeIn>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
