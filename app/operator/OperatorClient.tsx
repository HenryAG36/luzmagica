"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    TrendingUp,
    RotateCcw,
    AlertCircle,
    Truck,
    DollarSign,
    Sparkles,
    ShieldCheck,
    Check,
    Store,
    Send,
    Lock,
    LogOut,
    ShieldAlert,
} from "lucide-react";
import { useOperatorStore } from "@/store/useOperatorStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { useAuthStore } from "@/store/useAuthStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import TrendPanel from "@/components/operator/TrendPanel";
import ProductsPanel from "@/components/operator/ProductsPanel";
import OrdersPanel from "@/components/operator/OrdersPanel";
import AbandonedPanel from "@/components/operator/AbandonedPanel";
import ClaimsPanel from "@/components/operator/ClaimsPanel";

const emptySubscribe = () => () => {};

export default function OperatorClient() {
    const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
    const { currentUser, isAuthenticated, authReady, logout } = useAuthStore();

    const {
        tasks,
        launchChecklist,
        toggleTask,
        toggleChecklistItem,
    } = useOperatorStore();
    const { account } = useLoyaltyStore();

    // Tab state
    const searchParams = useSearchParams();
    const initialTab = searchParams.get("tab");
    const [activeTab, setActiveTab] = useState<"overview" | "orders" | "abandoned" | "checklist" | "trends" | "products" | "claims" | "team">(
        initialTab === "trends" || initialTab === "products" || initialTab === "claims" ? initialTab : "overview"
    );

    interface AdminRow {
        id: string;
        email: string;
        name: string;
        phone: string;
        createdAt: string;
    }
    const [adminUsers, setAdminUsers] = useState<AdminRow[]>([]);
    const [customerCount, setCustomerCount] = useState(0);
    const [teamError, setTeamError] = useState("");
    const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "", phone: "" });
    const [adminFormError, setAdminFormError] = useState("");
    const [adminFormSuccess, setAdminFormSuccess] = useState("");
    const [adminFormLoading, setAdminFormLoading] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const loadTeam = useCallback(async () => {
        setTeamError("");
        try {
            const res = await fetch("/api/admin/team");
            if (!res.ok) {
                setTeamError("No se pudo cargar el equipo (sesión sin permisos de administrador).");
                return;
            }
            const body = await res.json();
            setAdminUsers(body.admins ?? []);
            setCustomerCount(body.customerCount ?? 0);
        } catch {
            setTeamError("Error de red al cargar el equipo.");
        }
    }, []);

    useEffect(() => {
        if (activeTab === "team" && isAuthenticated) loadTeam();
    }, [activeTab, isAuthenticated, loadTeam]);

    interface OrderSummaryData {
        paidCount: number;
        paidRevenueCop: number;
        pendingCount: number;
        pendingRevenueCop: number;
        supplierCostCop: number;
        reviewCount: number;
        deliveredCount: number;
        totalCount: number;
    }
    const [orderSummary, setOrderSummary] = useState<OrderSummaryData | null>(null);

    interface AttentionData {
        paymentReview: number;
        supplierFailed: number;
        supplierStale: number;
        missingTracking: number;
        draftClaims: number;
        orders: { id: string; ref: string; issue: string }[];
    }
    const [attention, setAttention] = useState<AttentionData | null>(null);

    const loadAttention = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/orders?attention=1");
            if (!res.ok) return;
            const body = await res.json();
            setAttention(body.attention ?? null);
        } catch {
            // informational only
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) void loadAttention();
    }, [isAuthenticated, loadAttention]);

    const loadOrderSummary = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/orders?summary=1");
            if (!res.ok) return;
            const body = await res.json();
            setOrderSummary(body.summary ?? null);
        } catch {
            // keep last known summary; overview is informational only
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) void loadOrderSummary();
    }, [isAuthenticated, loadOrderSummary]);

    if (!mounted || !authReady) {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando Command Center...</div>
            </div>
        );
    }

    if (!currentUser || currentUser.role !== "admin") {
        return (
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <FadeIn>
                    <div className="max-w-lg mx-auto p-8 rounded-3xl bg-surface border border-amber-500/30 shadow-2xl glow-purple text-center">
                        <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto mb-5 text-amber-400">
                            <Lock className="w-8 h-8" />
                        </div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                            Área Protegida • Nivel Operador
                        </span>
                        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-white mt-4 mb-2">
                            Portal Exclusivo de Administrador
                        </h1>
                        <p className="text-xs sm:text-sm text-muted mb-6 leading-relaxed">
                            {currentUser
                                ? `Has iniciado sesión como ${currentUser.name} (Cliente). Este panel contiene costos de proveedor, órdenes de despacho y métricas comerciales restringidas a administradores.`
                                : "Para gestionar pedidos de despacho dropshipping, carritos abandonados y márgenes comerciales brutos, debes iniciar sesión con una cuenta de operador."}
                        </p>

                        <div className="space-y-3">
                            <Link
                                href="/login?redirect=/operator"
                                className="block w-full py-3.5 px-6 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs sm:text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
                            >
                                <ShieldCheck className="w-4 h-4" />
                                <span>Iniciar Sesión como Operador</span>
                            </Link>

                            <Link
                                href="/"
                                className="block text-xs text-muted hover:text-white pt-2 transition-colors"
                            >
                                Volver a la Tienda Pública
                            </Link>
                        </div>
                    </div>
                </FadeIn>
            </div>
        );
    }

    return (
        <div className="pt-28 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            {/* Operator Executive Header */}
            <FadeIn>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 mb-8 border-b border-white/10">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                            <span className="text-xs uppercase font-bold tracking-wider text-green-400">
                                Command Center Activo • Hub Operativo Owner
                            </span>
                        </div>
                        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white">
                            Panel del <span className="gradient-text">Operador & Retención</span>
                        </h1>
                        <p className="text-xs sm:text-sm text-muted mt-1">
                            Monitorea la retención de compradores, optimiza costos dropshipping y ejecuta acciones diarias.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Admin Identity pill */}
                        <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-amber-400" />
                            <span>{currentUser.name}</span>
                        </div>

                        <Link
                            href="/"
                            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-2 border border-white/10 transition-colors"
                        >
                            <Store className="w-4 h-4 text-primary" />
                            <span>Ver Tienda</span>
                        </Link>

                        <button
                            onClick={() => void logout()}
                            className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold flex items-center gap-1.5 border border-red-500/20 transition-colors"
                            title="Cerrar sesión de administrador"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Salir</span>
                        </button>
                    </div>
                </div>
            </FadeIn>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 border-b border-white/5 text-xs font-semibold">
                <button
                    onClick={() => setActiveTab("overview")}
                    className={`px-4 py-2 rounded-xl transition-all ${
                        activeTab === "overview"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    Resumen & Motor de Valor
                </button>
                <button
                    onClick={() => setActiveTab("orders")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "orders"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Pedidos & Despacho{orderSummary ? ` (${orderSummary.totalCount})` : ""}</span>
                </button>
                <button
                    onClick={() => setActiveTab("abandoned")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "abandoned"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Checkouts Abandonados</span>
                </button>
                <button
                    onClick={() => setActiveTab("checklist")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "checklist"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Checklist de Lanzamiento</span>
                </button>
                <button
                    onClick={() => setActiveTab("trends")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "trends"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Tendencias</span>
                </button>
                <button
                    onClick={() => setActiveTab("products")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "products"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Productos</span>
                </button>
                <button
                    onClick={() => setActiveTab("claims")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "claims"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>
                        Reclamos{attention && attention.draftClaims > 0 ? ` (${attention.draftClaims})` : ""}
                    </span>
                </button>
                <button
                    onClick={() => setActiveTab("team")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "team"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Equipo Admin ({adminUsers.length})</span>
                </button>
            </div>

            {/* TAB: OVERVIEW */}
            {activeTab === "overview" && (
                <div className="space-y-8">
                    {/* KPI Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Confirmed Revenue */}
                        <FadeIn delay={0.05}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Ventas Confirmadas</span>
                                    <div className="p-1.5 rounded-lg bg-green-500/10 text-green-400">
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {formatCOP(orderSummary?.paidRevenueCop ?? 0)}
                                </div>
                                <span className="text-[11px] text-green-400 font-medium">
                                    {orderSummary?.paidCount ?? 0} pedidos pagados
                                </span>
                            </div>
                        </FadeIn>

                        {/* Estimated Gross Margin */}
                        <FadeIn delay={0.1}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Margen Bruto Est.</span>
                                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                        <TrendingUp className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {orderSummary && orderSummary.supplierCostCop > 0
                                        ? formatCOP(orderSummary.paidRevenueCop - orderSummary.supplierCostCop)
                                        : "—"}
                                </div>
                                <span className="text-[11px] text-primary font-medium">
                                    tras costo de proveedor registrado
                                </span>
                            </div>
                        </FadeIn>

                        {/* Pending Payments */}
                        <FadeIn delay={0.15}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Pagos por Confirmar</span>
                                    <div className="p-1.5 rounded-lg bg-secondary/10 text-secondary">
                                        <RotateCcw className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {orderSummary?.pendingCount ?? 0}
                                </div>
                                <span className="text-[11px] text-secondary font-medium">
                                    {formatCOP(orderSummary?.pendingRevenueCop ?? 0)} en checkouts abiertos
                                </span>
                            </div>
                        </FadeIn>

                        {/* Loyalty Liability */}
                        <FadeIn delay={0.2}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Puntos LuzClub Activos</span>
                                    <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
                                        <Sparkles className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {account.points} pts
                                </div>
                                <span className="text-[11px] text-muted">
                                    Valor canjeable: {formatCOP(account.points * 10)}
                                </span>
                            </div>
                        </FadeIn>
                    </div>

                    {/* NEEDS ATTENTION — only items that truly need a human */}
                    {attention &&
                        (attention.paymentReview +
                            attention.supplierFailed +
                            attention.supplierStale +
                            attention.missingTracking +
                            attention.draftClaims >
                            0) && (
                            <FadeIn delay={0.22}>
                                <div className="p-6 rounded-3xl bg-red-500/5 border border-red-500/20">
                                    <h3 className="font-heading text-lg font-bold text-white flex items-center gap-2 mb-4">
                                        <ShieldAlert className="w-5 h-5 text-red-400" />
                                        <span>Requiere Atención</span>
                                    </h3>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs mb-4">
                                        {attention.paymentReview > 0 && (
                                            <button onClick={() => setActiveTab("orders")} className="p-3 rounded-xl bg-surface-card border border-red-500/20 text-left hover:border-red-500/40">
                                                <span className="font-bold text-red-300 text-lg block">{attention.paymentReview}</span>
                                                <span className="text-muted">Pagos en revisión</span>
                                            </button>
                                        )}
                                        {attention.supplierFailed > 0 && (
                                            <button onClick={() => setActiveTab("orders")} className="p-3 rounded-xl bg-surface-card border border-red-500/20 text-left hover:border-red-500/40">
                                                <span className="font-bold text-red-300 text-lg block">{attention.supplierFailed}</span>
                                                <span className="text-muted">Envíos a proveedor fallidos</span>
                                            </button>
                                        )}
                                        {attention.supplierStale > 0 && (
                                            <button onClick={() => setActiveTab("orders")} className="p-3 rounded-xl bg-surface-card border border-amber-500/20 text-left hover:border-amber-500/40">
                                                <span className="font-bold text-amber-300 text-lg block">{attention.supplierStale}</span>
                                                <span className="text-muted">Envíos atascados</span>
                                            </button>
                                        )}
                                        {attention.missingTracking > 0 && (
                                            <button onClick={() => setActiveTab("orders")} className="p-3 rounded-xl bg-surface-card border border-amber-500/20 text-left hover:border-amber-500/40">
                                                <span className="font-bold text-amber-300 text-lg block">{attention.missingTracking}</span>
                                                <span className="text-muted">Sin guía &gt;7 días</span>
                                            </button>
                                        )}
                                        {attention.draftClaims > 0 && (
                                            <button onClick={() => setActiveTab("claims")} className="p-3 rounded-xl bg-surface-card border border-amber-500/20 text-left hover:border-amber-500/40">
                                                <span className="font-bold text-amber-300 text-lg block">{attention.draftClaims}</span>
                                                <span className="text-muted">Reclamos por revisar</span>
                                            </button>
                                        )}
                                    </div>
                                    {attention.orders.length > 0 && (
                                        <div className="space-y-1.5 text-xs">
                                            {attention.orders.slice(0, 8).map((o) => (
                                                <button
                                                    key={o.id}
                                                    onClick={() => setActiveTab("orders")}
                                                    className="w-full flex justify-between items-center p-2.5 rounded-xl bg-surface-card/60 border border-white/5 hover:border-white/15 text-left"
                                                >
                                                    <span className="font-mono font-bold text-white">#{o.ref}</span>
                                                    <span className="text-red-300 text-[11px]">{o.issue}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </FadeIn>
                        )}

                    {/* PIPELINE SNAPSHOT — real order funnel, no projections */}
                    <FadeIn delay={0.25}>
                        <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-primary/15 via-surface-card to-secondary/15 border border-primary/30 glow-purple">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                <div className="max-w-xl">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-bold uppercase tracking-wider mb-3">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        Operación en Vivo
                                    </div>
                                    <h2 className="font-heading text-2xl sm:text-3xl font-bold text-white mb-2">
                                        Estado del <span className="gradient-text">Pipeline de Pedidos</span>
                                    </h2>
                                    <p className="text-xs sm:text-sm text-muted">
                                        Checkouts abiertos son compradores que iniciaron el pago y aún no lo confirman — tu mejor
                                        oportunidad de recuperación inmediata.
                                    </p>
                                </div>

                                <div className="p-5 rounded-2xl bg-surface/90 border border-white/10 text-center shrink-0 min-w-[240px]">
                                    <span className="text-xs text-muted block mb-1">Checkouts por Confirmar</span>
                                    <span className="font-heading text-3xl sm:text-4xl font-extrabold text-amber-300 block tracking-tight">
                                        {formatCOP(orderSummary?.pendingRevenueCop ?? 0)}
                                    </span>
                                    <span className="text-[11px] text-muted mt-1 block">
                                        {orderSummary?.pendingCount ?? 0} pedidos en pago pendiente
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10 text-xs">
                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Pedidos Pagados</span>
                                    <span className="font-bold text-white text-sm">
                                        {orderSummary?.paidCount ?? 0}
                                    </span>
                                    <span className="text-[10px] text-green-400 block mt-0.5">Confirmados por pasarela</span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Entregados</span>
                                    <span className="font-bold text-white text-sm">
                                        {orderSummary?.deliveredCount ?? 0}
                                    </span>
                                    <span className="text-[10px] text-primary block mt-0.5">Ciclo completado</span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Pagos en Revisión</span>
                                    <span className="font-bold text-white text-sm">
                                        {orderSummary?.reviewCount ?? 0}
                                    </span>
                                    <span className="text-[10px] text-accent block mt-0.5">Requieren verificación manual</span>
                                </div>
                            </div>
                        </div>
                    </FadeIn>

                    {/* Actionable Daily Tasks (Hestia Critical Attention Items) */}
                    <FadeIn delay={0.3}>
                        <div className="glass rounded-3xl p-6 md:p-8">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h3 className="font-heading text-lg font-bold text-white flex items-center gap-2">
                                        <AlertCircle className="w-5 h-5 text-accent" />
                                        <span>Tareas Críticas de Hoy (Command Center)</span>
                                    </h3>
                                    <p className="text-xs text-muted">
                                        Atención prioritaria para evitar retrasos en envíos o abandono de clientes
                                    </p>
                                </div>
                                <span className="text-xs font-mono text-muted">
                                    {tasks.filter((t) => !t.completed).length} pendientes
                                </span>
                            </div>

                            <div className="space-y-3">
                                {tasks.map((task) => (
                                    <div
                                        key={task.id}
                                        className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                                            task.completed
                                                ? "bg-surface/30 border-white/5 opacity-60"
                                                : "bg-surface-card border-white/10 hover:border-primary/30"
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <button
                                                onClick={() => toggleTask(task.id)}
                                                className={`mt-0.5 w-5 h-5 rounded-lg border flex items-center justify-center transition-colors shrink-0 ${
                                                    task.completed
                                                        ? "bg-green-500 border-green-500 text-black"
                                                        : "border-white/20 hover:border-primary"
                                                }`}
                                            >
                                                {task.completed && <Check className="w-3.5 h-3.5" />}
                                            </button>
                                            <div>
                                                <h4 className={`text-xs font-semibold ${task.completed ? "line-through text-muted" : "text-white"}`}>
                                                    {task.title}
                                                </h4>
                                                <p className="text-[11px] text-muted mt-0.5">{task.description}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0 pl-8 sm:pl-0">
                                            <span
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                    task.priority === "high"
                                                        ? "bg-red-500/20 text-red-300"
                                                        : "bg-amber-500/20 text-amber-300"
                                                }`}
                                            >
                                                {task.priority}
                                            </span>

                                            {task.type === "whatsapp_recovery" && (
                                                <button
                                                    onClick={() => setActiveTab("abandoned")}
                                                    className="px-3 py-1.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                                >
                                                    <Send className="w-3 h-3" />
                                                    <span>{task.actionLabel}</span>
                                                </button>
                                            )}

                                            {task.type === "fulfill_order" && (
                                                <button
                                                    onClick={() => {
                                                        setActiveTab("orders");
                                                    }}
                                                    className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                                >
                                                    <Truck className="w-3 h-3" />
                                                    <span>{task.actionLabel}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </FadeIn>
                </div>
            )}

            {/* TAB: ORDERS / DROPSHIP DISPATCH */}
            {activeTab === "orders" && <OrdersPanel />}

            {/* TAB: CLAIMS */}
            {activeTab === "claims" && <ClaimsPanel />}

            {/* TAB: ABANDONED CHECKOUTS */}
            {activeTab === "abandoned" && <AbandonedPanel />}

            {/* TAB: CHECKLIST */}
            {activeTab === "checklist" && (
                <div className="space-y-6">
                    <div>
                        <h3 className="font-heading text-xl font-bold text-white">
                            Checklist de Lanzamiento & Madurez del Negocio
                        </h3>
                        <p className="text-xs text-muted">
                            Pasos obligatorios para operar un negocio dropshipping de alta retención sin fricción técnica.
                        </p>
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8 space-y-3">
                        {launchChecklist.map((item) => (
                            <div
                                key={item.id}
                                onClick={() => toggleChecklistItem(item.id)}
                                className="p-4 rounded-2xl bg-surface-card border border-white/5 hover:border-white/15 cursor-pointer transition-all flex items-start gap-4"
                            >
                                <div
                                    className={`mt-0.5 w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                                        item.completed
                                            ? "bg-green-500 border-green-500 text-black"
                                            : "border-white/20"
                                    }`}
                                >
                                    {item.completed && <Check className="w-3.5 h-3.5" />}
                                </div>

                                <div className="flex-1">
                                    <h4 className={`text-xs font-semibold ${item.completed ? "text-white" : "text-white/80"}`}>
                                        {item.title}
                                    </h4>
                                    <p className="text-[11px] text-muted mt-0.5">{item.description}</p>
                                </div>

                                <span className="text-[10px] uppercase font-bold text-muted bg-white/5 px-2 py-0.5 rounded">
                                    {item.category}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* TAB: TENDENCIAS */}
            {activeTab === "trends" && <TrendPanel />}

            {/* TAB: PRODUCTOS */}
            {activeTab === "products" && <ProductsPanel />}

            {/* TAB: EQUIPO ADMIN */}
            {activeTab === "team" && (
                <div className="space-y-8">
                    {/* Header + Stats */}
                    <div>
                        <h3 className="font-heading text-xl font-bold text-white">
                            Equipo Administrador
                        </h3>
                        <p className="text-xs text-muted mt-1">
                            Solo los administradores pueden crear o revocar el acceso de otras cuentas de admin.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <div className="p-5 rounded-2xl bg-surface-card border border-white/5 text-center">
                            <div className="font-heading text-3xl font-bold text-primary">{adminUsers.length}</div>
                            <div className="text-xs text-muted mt-1">Administradores</div>
                        </div>
                        <div className="p-5 rounded-2xl bg-surface-card border border-white/5 text-center">
                            <div className="font-heading text-3xl font-bold text-white">{customerCount}</div>
                            <div className="text-xs text-muted mt-1">Clientes registrados</div>
                        </div>
                        <div className="p-5 rounded-2xl bg-surface-card border border-white/5 text-center col-span-2 sm:col-span-1">
                            <div className="font-heading text-3xl font-bold text-white">{adminUsers.length + customerCount}</div>
                            <div className="text-xs text-muted mt-1">Usuarios totales</div>
                        </div>
                    </div>

                    {/* Admin List */}
                    {teamError && (
                        <p className="text-xs text-red-400 bg-red-500/10 rounded-xl px-4 py-2">{teamError}</p>
                    )}

                    <div className="glass rounded-3xl p-6 md:p-8 space-y-4">
                        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-primary" />
                            Administradores activos
                        </h4>
                        {adminUsers.map((admin) => (
                            <div
                                key={admin.id}
                                className="p-4 rounded-2xl bg-surface-card border border-white/5 flex items-center justify-between gap-4"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-white truncate">{admin.name}</div>
                                    <div className="text-xs text-muted truncate">{admin.email}</div>
                                    {admin.phone && (
                                        <div className="text-xs text-muted">{admin.phone}</div>
                                    )}
                                    <div className="text-[11px] text-muted mt-0.5">
                                        Creado: {admin.createdAt}
                                        {admin.id === currentUser?.id && (
                                            <span className="ml-2 text-primary font-semibold">(tú)</span>
                                        )}
                                    </div>
                                </div>
                                {admin.id !== currentUser?.id && (
                                    confirmDeleteId === admin.id ? (
                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                onClick={async () => {
                                                    setTeamError("");
                                                    const res = await fetch(`/api/admin/team/${admin.id}`, { method: "DELETE" });
                                                    const body = await res.json().catch(() => ({}));
                                                    if (!res.ok) {
                                                        setTeamError(body.error || "No se pudo revocar el acceso del administrador.");
                                                    } else {
                                                        await loadTeam();
                                                    }
                                                    setConfirmDeleteId(null);
                                                }}
                                                className="px-3 py-1.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-xs font-semibold transition-colors"
                                            >
                                                Confirmar
                                            </button>
                                            <button
                                                onClick={() => setConfirmDeleteId(null)}
                                                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setConfirmDeleteId(admin.id)}
                                            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-red-500/20 text-muted hover:text-red-400 text-xs transition-all shrink-0"
                                        >
                                            Revocar acceso
                                        </button>
                                    )
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Create Admin Form */}
                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                            <Send className="w-4 h-4 text-primary" />
                            Crear nueva cuenta de administrador
                        </h4>
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                setAdminFormError("");
                                setAdminFormSuccess("");
                                setAdminFormLoading(true);
                                try {
                                    const res = await fetch("/api/admin/team", {
                                        method: "POST",
                                        headers: { "content-type": "application/json" },
                                        body: JSON.stringify(adminForm),
                                    });
                                    const body = await res.json().catch(() => ({}));
                                    if (res.ok) {
                                        setAdminFormSuccess(`✅ Admin "${adminForm.name}" creado exitosamente.`);
                                        setAdminForm({ name: "", email: "", password: "", phone: "" });
                                        await loadTeam();
                                    } else {
                                        setAdminFormError(body.error || "No se pudo crear el administrador.");
                                    }
                                } catch {
                                    setAdminFormError("Error de red al crear el administrador.");
                                } finally {
                                    setAdminFormLoading(false);
                                }
                            }}
                            className="space-y-4"
                        >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Nombre completo</label>
                                    <input
                                        type="text"
                                        required
                                        value={adminForm.name}
                                        onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
                                        placeholder="Ej. Valeria Torres"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Correo electrónico</label>
                                    <input
                                        type="email"
                                        required
                                        value={adminForm.email}
                                        onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                                        placeholder="admin@luzmagica.co"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Contraseña</label>
                                    <input
                                        type="password"
                                        required
                                        minLength={6}
                                        value={adminForm.password}
                                        onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                                        placeholder="Mínimo 6 caracteres"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Teléfono</label>
                                    <input
                                        type="tel"
                                        required
                                        value={adminForm.phone}
                                        onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })}
                                        placeholder="310 000 0000"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 transition-colors"
                                    />
                                </div>
                            </div>

                            {adminFormError && (
                                <p className="text-xs text-red-400 bg-red-500/10 rounded-xl px-4 py-2">{adminFormError}</p>
                            )}
                            {adminFormSuccess && (
                                <p className="text-xs text-green-400 bg-green-500/10 rounded-xl px-4 py-2">{adminFormSuccess}</p>
                            )}

                            <button
                                type="submit"
                                disabled={adminFormLoading}
                                className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold text-sm glow-purple transition-all disabled:opacity-50"
                            >
                                {adminFormLoading ? "Creando..." : "Crear administrador"}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
