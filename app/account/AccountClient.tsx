"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Sparkles,
    User,
    Package,
    MapPin,
    Phone,
    FileText,
    LogOut,
    Check,
    Truck,
    RotateCcw,
    ExternalLink,
    Award,
    Edit3,
    Save,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { useCartStore } from "@/store/useCartStore";
import { formatCOP } from "@/lib/utils";
import { TIER_THRESHOLDS } from "@/lib/loyalty";
import FadeIn from "@/components/common/FadeIn";
import type { LoyaltyTier, Product } from "@/lib/types";
import { FULFILLMENT_STATUS_LABELS, type PublicOrder } from "@/lib/orders/types";

const emptySubscribe = () => () => {};

export default function AccountClient() {
    const router = useRouter();
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

    const { currentUser, logout, updateProfile } = useAuthStore();
    const { account, openModal, getTierProgress } = useLoyaltyStore();
    const { addItem } = useCartStore();

    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({
        name: "",
        phone: "",
        cedula: "",
        address: "",
        city: "",
    });
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [reorderSuccessId, setReorderSuccessId] = useState<string | null>(null);
    const [customerOrders, setCustomerOrders] = useState<PublicOrder[] | null>(null);
    const [ordersError, setOrdersError] = useState(false);
    const [serverBalance, setServerBalance] = useState<{
        points: number;
        lifetimePoints: number;
        tier: LoyaltyTier;
    } | null>(null);

    useEffect(() => {
        if (!currentUser) return;
        let cancelled = false;
        fetch("/api/loyalty/balance")
            .then(async (res) => {
                if (!res.ok) return;
                const body = await res.json();
                if (!cancelled && body.balance) setServerBalance(body.balance);
            })
            .catch(() => {});
        fetch("/api/orders/mine")
            .then(async (res) => {
                if (!res.ok) throw new Error("fetch failed");
                const body = await res.json();
                if (!cancelled) setCustomerOrders(body.orders ?? []);
            })
            .catch(() => {
                if (!cancelled) setOrdersError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [currentUser]);

    if (!mounted) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando cuenta...</div>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="text-center max-w-md mx-auto p-8 rounded-3xl bg-surface-card border border-white/10 glow-purple">
                        <div className="w-16 h-16 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4 text-primary">
                            <User className="w-8 h-8" />
                        </div>
                        <h1 className="font-heading text-2xl font-bold text-white mb-2">
                            Inicia Sesión en LuzClub
                        </h1>
                        <p className="text-xs sm:text-sm text-muted mb-6">
                            Para acceder a tu perfil, historial de pedidos y recompensas exclusivas, inicia sesión o crea tu cuenta.
                        </p>
                        <Link
                            href="/login?redirect=/account"
                            className="block w-full py-3.5 px-6 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold text-xs sm:text-sm glow-purple transition-all"
                        >
                            Iniciar Sesión o Registrarme
                        </Link>
                    </div>
                </FadeIn>
            </div>
        );
    }

    const browserProgress = getTierProgress();
    // Server balance (earned through verified payments) takes precedence;
    // the browser store is only a fallback for display.
    const lifetimePoints = serverBalance?.lifetimePoints ?? account.lifetimePoints;
    const currentTier = serverBalance?.tier ?? browserProgress.currentTier;
    const displayPoints = serverBalance?.points ?? account.points;
    const progressPercent =
        serverBalance !== null
            ? lifetimePoints >= TIER_THRESHOLDS.galactico
                ? 100
                : lifetimePoints >= TIER_THRESHOLDS.oro
                  ? Math.min(100, Math.round(((lifetimePoints - TIER_THRESHOLDS.oro) / (TIER_THRESHOLDS.galactico - TIER_THRESHOLDS.oro)) * 100))
                  : lifetimePoints >= TIER_THRESHOLDS.plata
                    ? Math.min(100, Math.round(((lifetimePoints - TIER_THRESHOLDS.plata) / (TIER_THRESHOLDS.oro - TIER_THRESHOLDS.plata)) * 100))
                    : Math.min(100, Math.round((lifetimePoints / TIER_THRESHOLDS.plata) * 100))
            : browserProgress.progressPercent;

    const handleStartEdit = () => {
        setEditForm({
            name: currentUser.name,
            phone: currentUser.phone,
            cedula: currentUser.cedula,
            address: currentUser.address,
            city: currentUser.city,
        });
        setIsEditing(true);
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        const result = await updateProfile(editForm);
        if (result.success) {
            setIsEditing(false);
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 2500);
        }
    };

    // Reorder re-adds items at their CURRENT published price — never the
    // historical snapshot, since supplier pricing may have changed.
    const handleReorder = async (order: PublicOrder) => {
        for (const item of order.items) {
            try {
                const res = await fetch(`/api/products/${encodeURIComponent(item.productId)}`);
                if (!res.ok) continue;
                const body = await res.json();
                if (body.product) addItem(body.product as Product, item.quantity);
            } catch {
                // skip unavailable item
            }
        }
        setReorderSuccessId(order.ref);
        setTimeout(() => setReorderSuccessId(null), 2500);
    };

    const handleLogout = () => {
        void logout();
        router.push("/");
    };

    const inputClass =
        "w-full px-4 py-2.5 rounded-xl bg-surface border border-white/10 text-white placeholder-muted focus:outline-none focus:border-primary text-xs";

    return (
        <div className="pt-28 pb-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
            <FadeIn>
                {/* Profile Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 mb-8 border-b border-white/10">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center font-heading text-2xl font-bold text-white shadow-lg glow-purple">
                            {currentUser.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <h1 className="font-heading text-2xl sm:text-3xl font-bold text-white">
                                    {currentUser.name}
                                </h1>
                                <span
                                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                        currentUser.role === "admin"
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                            : "bg-primary/20 text-primary border border-primary/30"
                                    }`}
                                >
                                    {currentUser.role === "admin" ? "Administrador" : `Socio ${currentTier}`}
                                </span>
                            </div>
                            <p className="text-xs text-muted">
                                {currentUser.email} • Registrado en {currentUser.createdAt}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {currentUser.role === "admin" && (
                            <Link
                                href="/operator"
                                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow-lg"
                            >
                                Ir a Command Center
                            </Link>
                        )}

                        <button
                            onClick={handleLogout}
                            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-muted hover:text-red-300 text-xs font-semibold flex items-center gap-1.5 border border-white/10 transition-colors"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Cerrar Sesión</span>
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left: Loyalty & Profile Info */}
                    <div className="space-y-6">
                        {/* LuzPoints Summary Card */}
                        <div className="p-6 rounded-3xl bg-gradient-to-br from-primary/20 via-surface-card to-secondary/15 border border-primary/30 glow-purple">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs text-muted flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                                    <span>LuzClub VIP Recompensas</span>
                                </span>
                                <span className="text-[10px] font-bold uppercase bg-white/10 px-2 py-0.5 rounded text-white">
                                    Nivel {currentTier}
                                </span>
                            </div>

                            <div className="flex items-baseline justify-between mb-4">
                                <span className="font-heading text-3xl font-extrabold text-white">
                                    {displayPoints.toLocaleString()} <span className="text-sm font-normal text-primary">pts</span>
                                </span>
                                <span className="text-sm font-bold text-green-400">
                                    {formatCOP(displayPoints * 10)}
                                </span>
                            </div>

                            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mb-4">
                                <div
                                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>

                            <button
                                onClick={openModal}
                                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                            >
                                <Award className="w-4 h-4 text-accent" />
                                <span>Ver Beneficios & Código de Referidos</span>
                            </button>
                        </div>

                        {/* Customer Details Card */}
                        <div className="glass rounded-3xl p-6 border border-white/10">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-heading text-sm font-bold text-white flex items-center gap-2">
                                    <User className="w-4 h-4 text-primary" />
                                    <span>Datos de Envío Guardados</span>
                                </h3>
                                {!isEditing && (
                                    <button
                                        onClick={handleStartEdit}
                                        className="text-xs text-primary hover:text-primary-light flex items-center gap-1"
                                    >
                                        <Edit3 className="w-3.5 h-3.5" />
                                        <span>Editar</span>
                                    </button>
                                )}
                            </div>

                            {savedSuccess && (
                                <div className="p-2.5 rounded-xl bg-green-500/20 text-green-300 text-xs mb-3 flex items-center gap-2">
                                    <Check className="w-4 h-4" />
                                    <span>Datos actualizados correctamente.</span>
                                </div>
                            )}

                            {isEditing ? (
                                <form onSubmit={handleSaveProfile} className="space-y-3">
                                    <div>
                                        <label className="text-[11px] text-muted block mb-1">Nombre</label>
                                        <input
                                            type="text"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-muted block mb-1">Teléfono</label>
                                        <input
                                            type="tel"
                                            value={editForm.phone}
                                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-muted block mb-1">Cédula</label>
                                        <input
                                            type="text"
                                            value={editForm.cedula}
                                            onChange={(e) => setEditForm({ ...editForm, cedula: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-muted block mb-1">Dirección</label>
                                        <input
                                            type="text"
                                            value={editForm.address}
                                            onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-muted block mb-1">Ciudad</label>
                                        <input
                                            type="text"
                                            value={editForm.city}
                                            onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsEditing(false)}
                                            className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted hover:text-white text-xs"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            className="flex-1 py-2 rounded-xl bg-primary hover:bg-primary-light text-white font-semibold text-xs flex items-center justify-center gap-1.5 glow-purple"
                                        >
                                            <Save className="w-3.5 h-3.5" />
                                            <span>Guardar</span>
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="space-y-3 text-xs">
                                    <div className="flex items-center gap-2.5 text-muted">
                                        <Phone className="w-4 h-4 text-primary shrink-0" />
                                        <span className="text-white">{currentUser.phone}</span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-muted">
                                        <FileText className="w-4 h-4 text-primary shrink-0" />
                                        <span>Cédula: <strong className="text-white">{currentUser.cedula}</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-muted">
                                        <MapPin className="w-4 h-4 text-secondary shrink-0" />
                                        <span className="text-white">{currentUser.address}, {currentUser.city}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Order History */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="glass rounded-3xl p-6 sm:p-8 border border-white/10">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="font-heading text-lg font-bold text-white flex items-center gap-2">
                                    <Package className="w-5 h-5 text-primary" />
                                    <span>Tus Pedidos & Despachos{customerOrders ? ` (${customerOrders.length})` : ""}</span>
                                </h3>
                                <Link
                                    href="/products"
                                    className="text-xs text-primary hover:text-primary-light"
                                >
                                    Ver Catálogo
                                </Link>
                            </div>

                            {ordersError ? (
                                <div className="text-center py-10 text-muted text-xs">
                                    No pudimos cargar tus pedidos. Recarga la página o consulta por referencia en{" "}
                                    <Link href="/tracking" className="text-primary hover:underline">
                                        Rastreo
                                    </Link>
                                    .
                                </div>
                            ) : customerOrders === null ? (
                                <div className="text-center py-10 text-muted text-xs animate-pulse">
                                    Cargando tus pedidos…
                                </div>
                            ) : customerOrders.length === 0 ? (
                                <div className="text-center py-10 text-muted text-xs">
                                    Aún no tienes pedidos registrados con esta cuenta.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {customerOrders.map((order) => {
                                        const isReordered = reorderSuccessId === order.ref;

                                        return (
                                            <div
                                                key={order.ref}
                                                className="p-4 sm:p-5 rounded-2xl bg-surface-card border border-white/5 hover:border-white/15 transition-all"
                                            >
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="font-mono font-bold text-white text-sm">
                                                                #{order.ref}
                                                            </span>
                                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-white">
                                                                {FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus]}
                                                            </span>
                                                        </div>
                                                        <span className="text-[11px] text-muted">
                                                            {new Date(order.createdAt).toLocaleDateString("es-CO")}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => void handleReorder(order)}
                                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                                                isReordered
                                                                    ? "bg-green-600 text-white"
                                                                    : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
                                                            }`}
                                                        >
                                                            {isReordered ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
                                                            <span>{isReordered ? "¡Añadido!" : "Pedir de Nuevo"}</span>
                                                        </button>

                                                        <Link
                                                            href={`/tracking?orderId=${order.ref}`}
                                                            className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-1.5 glow-purple transition-all"
                                                        >
                                                            <Truck className="w-3 h-3" />
                                                            <span>Rastrear</span>
                                                            <ExternalLink className="w-3 h-3 opacity-60" />
                                                        </Link>
                                                    </div>
                                                </div>

                                                <div className="pt-3 text-xs space-y-2">
                                                    <div className="flex justify-between text-muted">
                                                        <span>Transportadora:</span>
                                                        <span className="text-white font-medium">
                                                            {order.carrier
                                                                ? `${order.carrier} (Guía: ${order.trackingNumber ?? "pendiente"})`
                                                                : "Por asignar"}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between text-muted">
                                                        <span>Productos:</span>
                                                        <span className="text-white truncate max-w-[280px]">
                                                            {order.items.map((i) => `${i.name} (x${i.quantity})`).join(", ")}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between font-bold text-white pt-1">
                                                        <span>Total Pagado:</span>
                                                        <span className="text-accent">{formatCOP(order.totalCop)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </FadeIn>
        </div>
    );
}
