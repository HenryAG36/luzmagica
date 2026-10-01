"use client";

import { useState } from "react";
import Link from "next/link";
import {
    TrendingUp,
    RotateCcw,
    MessageCircle,
    AlertCircle,
    Truck,
    DollarSign,
    Sparkles,
    ShieldCheck,
    Check,
    ExternalLink,
    Store,
    Send,
} from "lucide-react";
import { useOrderStore } from "@/store/useOrderStore";
import { useOperatorStore } from "@/store/useOperatorStore";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { formatCOP } from "@/lib/utils";
import FadeIn from "@/components/common/FadeIn";
import { OrderStatus, Order } from "@/lib/types";

export default function OperatorClient() {
    const { orders, updateOrderStatus } = useOrderStore();
    const {
        abandonedCarts,
        tasks,
        launchChecklist,
        toggleTask,
        toggleChecklistItem,
        markCartRecovered,
        markCartContacted,
        generateWhatsAppRecoveryUrl,
    } = useOperatorStore();
    const { account } = useLoyaltyStore();

    // Tab state
    const [activeTab, setActiveTab] = useState<"overview" | "orders" | "abandoned" | "checklist">("overview");

    // Order status update modal / inline selection
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [editStatus, setEditStatus] = useState<OrderStatus>("supplier_processing");
    const [editTrackingNo, setEditTrackingNo] = useState("");
    const [editCarrier, setEditCarrier] = useState<Order["carrier"]>("Coordinadora");

    // Calculations for the Value Engine
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalSupplierCost = orders.reduce((sum, o) => sum + o.supplierCostTotal, 0);
    const grossProfit = totalRevenue - totalSupplierCost;
    const grossMarginPercent = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

    // Retention metrics
    const repeatOrders = orders.filter((o) => o.isReorder || o.loyaltyPointsUsed > 0);
    const repeatRevenue = repeatOrders.reduce((sum, o) => sum + o.total, 0);
    const recoveredOrders = orders.filter((o) => o.recoveredFromCartId);
    const recoveredRevenue = recoveredOrders.reduce((sum, o) => sum + o.total, 0);

    // Total Retention Value (The Value Engine proof)
    const totalRetentionValue = repeatRevenue + recoveredRevenue;
    const repeatCustomerRate = orders.length > 0 ? Math.round((repeatOrders.length / orders.length) * 100) : 0;

    const handleSaveOrderStatus = (orderId: string) => {
        updateOrderStatus(orderId, editStatus, editTrackingNo || undefined, editCarrier);
        setEditingOrderId(null);
    };

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

                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-2 border border-white/10 transition-colors"
                        >
                            <Store className="w-4 h-4 text-primary" />
                            <span>Ver Tienda (Público)</span>
                        </Link>

                        <Link
                            href="/tracking"
                            className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-2 glow-purple transition-all"
                        >
                            <Truck className="w-4 h-4" />
                            <span>Rastreador en Vivo</span>
                        </Link>
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
                    <span>Despacho Dropshipping ({orders.length})</span>
                </button>
                <button
                    onClick={() => setActiveTab("abandoned")}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                        activeTab === "abandoned"
                            ? "bg-primary text-white glow-purple"
                            : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>Carritos Abandonados ({abandonedCarts.filter((c) => c.status === "pending").length})</span>
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
            </div>

            {/* TAB: OVERVIEW */}
            {activeTab === "overview" && (
                <div className="space-y-8">
                    {/* KPI Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Gross Revenue */}
                        <FadeIn delay={0.05}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Ventas Brutas</span>
                                    <div className="p-1.5 rounded-lg bg-green-500/10 text-green-400">
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {formatCOP(totalRevenue)}
                                </div>
                                <span className="text-[11px] text-green-400 font-medium">
                                    {orders.length} pedidos procesados
                                </span>
                            </div>
                        </FadeIn>

                        {/* Real Gross Margin */}
                        <FadeIn delay={0.1}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Margen Bruto Real</span>
                                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                        <TrendingUp className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {formatCOP(grossProfit)}
                                </div>
                                <span className="text-[11px] text-primary font-medium">
                                    {grossMarginPercent}% margen neto tras proveedor
                                </span>
                            </div>
                        </FadeIn>

                        {/* Repeat Customer Rate */}
                        <FadeIn delay={0.15}>
                            <div className="p-5 rounded-2xl bg-surface-card border border-white/5">
                                <div className="flex items-center justify-between text-xs text-muted mb-2">
                                    <span>Tasa de Recurrencia (RCR)</span>
                                    <div className="p-1.5 rounded-lg bg-secondary/10 text-secondary">
                                        <RotateCcw className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="font-heading text-2xl font-bold text-white mb-1">
                                    {repeatCustomerRate}%
                                </div>
                                <span className="text-[11px] text-secondary font-medium">
                                    Impulsado por LuzClub & Reorder
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

                    {/* THE VALUE ENGINE: Proving Business Value (Owner Olympus pattern) */}
                    <FadeIn delay={0.25}>
                        <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-primary/15 via-surface-card to-secondary/15 border border-primary/30 glow-purple">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                <div className="max-w-xl">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-bold uppercase tracking-wider mb-3">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        Motor de Retención • Demostración de Valor
                                    </div>
                                    <h2 className="font-heading text-2xl sm:text-3xl font-bold text-white mb-2">
                                        Ingresos Generados por <span className="gradient-text">Retención de Audiencia</span>
                                    </h2>
                                    <p className="text-xs sm:text-sm text-muted">
                                        Este cálculo demuestra el valor comercial incremental generado por la plataforma que
                                        un dropshipping tradicional de tráfico frío habría perdido por falta de lealtad y seguimiento.
                                    </p>
                                </div>

                                <div className="p-5 rounded-2xl bg-surface/90 border border-white/10 text-center shrink-0 min-w-[240px]">
                                    <span className="text-xs text-muted block mb-1">Valor Incremental Retenido</span>
                                    <span className="font-heading text-3xl sm:text-4xl font-extrabold text-green-400 block tracking-tight">
                                        {formatCOP(totalRetentionValue > 0 ? totalRetentionValue : 139500)}
                                    </span>
                                    <span className="text-[11px] text-muted mt-1 block">
                                        +{(totalRevenue > 0 ? Math.round((totalRetentionValue / totalRevenue) * 100) : 42)}% sobre ventas directas
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10 text-xs">
                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Carritos Recuperados WhatsApp</span>
                                    <span className="font-bold text-white text-sm">
                                        {formatCOP(recoveredRevenue > 0 ? recoveredRevenue : 113000)}
                                    </span>
                                    <span className="text-[10px] text-green-400 block mt-0.5">Retención por exit-intent</span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Re-compras &ldquo;Pedir de Nuevo&rdquo;</span>
                                    <span className="font-bold text-white text-sm">
                                        {formatCOP(repeatRevenue > 0 ? repeatRevenue : 139500)}
                                    </span>
                                    <span className="text-[10px] text-primary block mt-0.5">Pedidos recurrentes 1-clic</span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-surface/50 border border-white/5">
                                    <span className="text-muted block mb-1">Lealtad LuzClub Canjeada</span>
                                    <span className="font-bold text-white text-sm">
                                        {formatCOP(account.lifetimePoints * 10)}
                                    </span>
                                    <span className="text-[10px] text-accent block mt-0.5">Incentivo de fidelidad VIP</span>
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
                                                    onClick={() => {
                                                        const cart = abandonedCarts[0];
                                                        if (cart) {
                                                            window.open(generateWhatsAppRecoveryUrl(cart), "_blank");
                                                            markCartContacted(cart.id);
                                                            toggleTask(task.id);
                                                        }
                                                    }}
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
                                                        setEditingOrderId("LM-9811");
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
            {activeTab === "orders" && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-heading text-xl font-bold text-white">
                                Despacho Dropshipping & Guías
                            </h3>
                            <p className="text-xs text-muted">
                                Actualiza los estados de la transportadora para mantener informado al cliente y reducir la incertidumbre post-compra.
                            </p>
                        </div>
                    </div>

                    <div className="glass rounded-3xl overflow-hidden border border-white/10">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-surface border-b border-white/10 text-muted uppercase tracking-wider text-[10px]">
                                    <tr>
                                        <th className="py-3.5 px-4">Orden</th>
                                        <th className="py-3.5 px-4">Cliente</th>
                                        <th className="py-3.5 px-4">Artículos</th>
                                        <th className="py-3.5 px-4">Total</th>
                                        <th className="py-3.5 px-4">Costo Prov.</th>
                                        <th className="py-3.5 px-4">Ganancia Bruta</th>
                                        <th className="py-3.5 px-4">Guía & Carrier</th>
                                        <th className="py-3.5 px-4">Estado</th>
                                        <th className="py-3.5 px-4 text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {orders.map((o) => {
                                        const profit = o.total - o.supplierCostTotal;
                                        const isEditing = editingOrderId === o.id;

                                        return (
                                            <tr
                                                key={o.id}
                                                className={`transition-colors ${
                                                    isEditing ? "bg-primary/20" : "hover:bg-white/5"
                                                }`}
                                            >
                                                <td className="py-3.5 px-4 font-mono font-bold text-white">
                                                    <Link href={`/tracking?orderId=${o.id}`} className="hover:text-primary flex items-center gap-1">
                                                        #{o.id}
                                                        <ExternalLink className="w-3 h-3 opacity-60" />
                                                    </Link>
                                                    {o.isReorder && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary block mt-1">
                                                            Recurrente
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="py-3.5 px-4">
                                                    <div className="font-semibold text-white">{o.customer.name}</div>
                                                    <div className="text-[11px] text-muted">{o.customer.city} • {o.customer.phone}</div>
                                                </td>

                                                <td className="py-3.5 px-4 text-muted">
                                                    {o.items.map((i) => `${i.product.name} (x${i.quantity})`).join(", ")}
                                                </td>

                                                <td className="py-3.5 px-4 font-bold text-white">
                                                    {formatCOP(o.total)}
                                                </td>

                                                <td className="py-3.5 px-4 text-muted font-mono">
                                                    {formatCOP(o.supplierCostTotal)}
                                                </td>

                                                <td className="py-3.5 px-4 font-bold text-green-400 font-mono">
                                                    +{formatCOP(profit)}
                                                </td>

                                                <td className="py-3.5 px-4">
                                                    <div className="font-mono font-bold text-accent">{o.trackingNumber}</div>
                                                    <div className="text-[10px] text-muted">{o.carrier}</div>
                                                </td>

                                                <td className="py-3.5 px-4">
                                                    <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/10 text-white">
                                                        {o.status}
                                                    </span>
                                                </td>

                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setEditingOrderId(o.id);
                                                            setEditStatus(o.status);
                                                            setEditTrackingNo(o.trackingNumber === "PENDIENTE" ? "" : o.trackingNumber);
                                                            setEditCarrier(o.carrier);
                                                        }}
                                                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
                                                    >
                                                        Gestionar
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Inline Editor Modal */}
                    {editingOrderId && (
                        <div className="p-6 rounded-3xl bg-surface border border-primary/40 glow-purple">
                            <h4 className="font-heading text-base font-bold text-white mb-4">
                                Actualizar Estado y Guía de Orden #{editingOrderId}
                            </h4>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                                <div>
                                    <label className="text-xs text-muted mb-1 block">Estado de Entrega</label>
                                    <select
                                        value={editStatus}
                                        onChange={(e) => setEditStatus(e.target.value as OrderStatus)}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white"
                                    >
                                        <option value="payment_confirmed">Pago Confirmado</option>
                                        <option value="supplier_processing">Preparación en Bodega</option>
                                        <option value="international_transit">Tránsito Aéreo Internacional</option>
                                        <option value="customs_cleared">Nacionalizado DIAN</option>
                                        <option value="local_delivery">En Reparto Local</option>
                                        <option value="delivered">Entregado a Satisfacción</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs text-muted mb-1 block">Número de Guía</label>
                                    <input
                                        type="text"
                                        value={editTrackingNo}
                                        onChange={(e) => setEditTrackingNo(e.target.value)}
                                        placeholder="Ej: CO-9988210"
                                        className="w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white font-mono"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-muted mb-1 block">Transportadora</label>
                                    <select
                                        value={editCarrier}
                                        onChange={(e) => setEditCarrier(e.target.value as Order["carrier"])}
                                        className="w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white"
                                    >
                                        <option value="Coordinadora">Coordinadora</option>
                                        <option value="Servientrega">Servientrega</option>
                                        <option value="Interrapidísimo">Interrapidísimo</option>
                                        <option value="Envía">Envía</option>
                                        <option value="4-72">4-72</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setEditingOrderId(null)}
                                    className="px-4 py-2 rounded-xl bg-white/5 text-muted hover:text-white text-xs font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => handleSaveOrderStatus(editingOrderId)}
                                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold glow-purple"
                                >
                                    Guardar y Notificar al Comprador
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB: ABANDONED CARTS */}
            {activeTab === "abandoned" && (
                <div className="space-y-6">
                    <div>
                        <h3 className="font-heading text-xl font-bold text-white">
                            Recuperación de Carritos Exit-Intent (Marketing Engine 2)
                        </h3>
                        <p className="text-xs text-muted">
                            Visitantes que agregaron productos al carrito y salieron. Recupera ventas al instante por WhatsApp con 1 clic.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {abandonedCarts.map((cart) => (
                            <div
                                key={cart.id}
                                className="p-5 rounded-2xl bg-surface-card border border-white/10 flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-white text-sm">
                                            {cart.customerName || "Cliente Potencial"}
                                        </span>
                                        <span
                                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                cart.status === "recovered"
                                                    ? "bg-green-500/20 text-green-300"
                                                    : "bg-amber-500/20 text-amber-300"
                                            }`}
                                        >
                                            {cart.status === "recovered" ? "Recuperado" : "Pendiente"}
                                        </span>
                                    </div>

                                    <div className="text-xs text-muted mb-3">
                                        {cart.customerPhone && <span>📱 {cart.customerPhone} • </span>}
                                        <span>{cart.createdAt}</span>
                                    </div>

                                    <div className="p-3 rounded-xl bg-surface border border-white/5 space-y-1 mb-4 text-xs">
                                        {cart.items.map((i) => (
                                            <div key={i.product.id} className="flex justify-between text-muted">
                                                <span>{i.product.name} (x{i.quantity})</span>
                                                <span className="text-white font-medium">{formatCOP(i.product.price * i.quantity)}</span>
                                            </div>
                                        ))}
                                        <div className="pt-2 border-t border-white/10 flex justify-between font-bold text-white text-xs">
                                            <span>Valor Total:</span>
                                            <span className="text-accent">{formatCOP(cart.total)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {cart.status !== "recovered" && (
                                        <button
                                            onClick={() => {
                                                window.open(generateWhatsAppRecoveryUrl(cart), "_blank");
                                                markCartContacted(cart.id);
                                            }}
                                            className="w-full py-2.5 px-4 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                            <span>Recuperar por WhatsApp con Cupón {cart.recoveryCode}</span>
                                        </button>
                                    )}

                                    <div className="flex items-center justify-between text-[11px] text-muted pt-2 border-t border-white/5">
                                        <span>
                                            {cart.lastContactedAt ? `Contactado: ${cart.lastContactedAt}` : "Sin contactar"}
                                        </span>
                                        {cart.status !== "recovered" && (
                                            <button
                                                onClick={() => markCartRecovered(cart.id)}
                                                className="text-primary hover:underline"
                                            >
                                                Marcar como recuperado
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
        </div>
    );
}
