"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, PackageCheck, RefreshCw, Truck } from "lucide-react";
import ReviewsPanel from "@/components/operator/ReviewsPanel";
import { formatCOP } from "@/lib/utils";
import {
    FULFILLMENT_STATUS_LABELS,
    PAYMENT_STATUS_LABELS,
    type FulfillmentStatus,
    type OrderEventRow,
    type OrderItemRow,
    type OrderRow,
    type PaymentStatus,
} from "@/lib/orders/types";

interface AdminOrder extends OrderRow {
    items: OrderItemRow[];
    events: OrderEventRow[];
}

const FULFILLMENT_SEQUENCE: FulfillmentStatus[] = [
    "payment_confirmed",
    "supplier_processing",
    "international_transit",
    "customs_cleared",
    "local_delivery",
    "delivered",
];

function nextStatuses(current: FulfillmentStatus): FulfillmentStatus[] {
    const idx = FULFILLMENT_SEQUENCE.indexOf(current);
    const forward = idx >= 0 ? FULFILLMENT_SEQUENCE.slice(idx + 1) : [];
    if (current === "delivered" || current === "cancelled") return [];
    return [...forward, "cancelled"];
}

function paymentBadge(status: PaymentStatus) {
    switch (status) {
        case "paid":
            return "bg-green-500/20 text-green-300 border-green-500/30";
        case "pending_payment":
            return "bg-amber-500/20 text-amber-300 border-amber-500/30";
        case "payment_review":
            return "bg-red-500/20 text-red-300 border-red-500/40";
        case "payment_failed":
            return "bg-red-500/10 text-red-300 border-red-500/20";
        default:
            return "bg-white/10 text-muted border-white/10";
    }
}

const FILTERS: { value: string; label: string }[] = [
    { value: "", label: "Todos" },
    { value: "paid", label: "Pagados" },
    { value: "pending_payment", label: "Pago pendiente" },
    { value: "payment_review", label: "Revisión" },
    { value: "payment_failed", label: "Fallidos" },
    { value: "cancelled", label: "Cancelados" },
    { value: "refunded", label: "Reembolsados" },
];

const CARRIERS = ["Coordinadora", "Servientrega", "Interrapidísimo", "Envía", "4-72", "Otra"];

export default function OrdersPanel() {
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [filter, setFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editStatus, setEditStatus] = useState<FulfillmentStatus | "">("");
    const [editTracking, setEditTracking] = useState("");
    const [editCarrier, setEditCarrier] = useState("Coordinadora");
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");
    const [fulfilling, setFulfilling] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const url = filter ? `/api/admin/orders?status=${filter}` : "/api/admin/orders";
            const res = await fetch(url);
            if (!res.ok) {
                setError("No se pudieron cargar los pedidos.");
                setOrders([]);
                return;
            }
            const body = await res.json();
            setOrders(body.orders ?? []);
        } catch {
            setError("Error de red al cargar los pedidos.");
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => {
        void load();
    }, [load]);

    const patch = async (id: string, payload: Record<string, unknown>, expectedUpdatedAt: string) => {
        setSaving(true);
        setActionError("");
        try {
            const res = await fetch(`/api/admin/orders/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, expectedUpdatedAt }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setActionError(body.error || "No se pudo actualizar el pedido.");
                return;
            }
            await load();
        } catch {
            setActionError("Error de red al actualizar.");
        } finally {
            setSaving(false);
        }
    };

    const handleSave = (order: AdminOrder) => {
        const payload: Record<string, unknown> = {};
        if (editStatus) payload.fulfillmentStatus = editStatus;
        if (editTracking.trim()) {
            payload.trackingNumber = editTracking.trim();
            payload.carrier = editCarrier;
        }
        void patch(order.id, payload, order.updated_at);
    };

    const supplierCostOf = (o: AdminOrder) =>
        o.items.reduce((sum, i) => sum + (i.unit_supplier_cost_cop ?? 0) * i.quantity, 0);

    const hasSupplierItems = (o: AdminOrder) =>
        o.items.some((i) => i.source === "aliexpress_ds" || i.source === "cjdropshipping");

    const placeSupplierOrder = async (order: AdminOrder) => {
        setFulfilling(order.id);
        setActionError("");
        try {
            const res = await fetch(`/api/admin/orders/${order.id}/fulfill`, { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setActionError(body.error || "No se pudo enviar el pedido al proveedor.");
                return;
            }
            await load();
        } catch {
            setActionError("Error de red al contactar el proveedor.");
        } finally {
            setFulfilling(null);
        }
    };

    const inputClass =
        "w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white";

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-white">Pedidos & Despacho</h3>
                    <p className="text-xs text-muted">
                        Órdenes reales confirmadas por la pasarela de pagos. Gestiona el despacho y la guía.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white"
                    >
                        {FILTERS.map((f) => (
                            <option key={f.value} value={f.value}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => void load()}
                        className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/10"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Actualizar
                    </button>
                </div>
            </div>

            {actionError && (
                <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
                    {actionError}
                </p>
            )}
            {error && (
                <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
                    {error}
                </p>
            )}

            <div className="glass rounded-3xl overflow-hidden border border-white/10">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-surface border-b border-white/10 text-muted uppercase tracking-wider text-[10px]">
                            <tr>
                                <th className="py-3.5 px-4">Orden</th>
                                <th className="py-3.5 px-4">Cliente</th>
                                <th className="py-3.5 px-4">Artículos</th>
                                <th className="py-3.5 px-4">Total</th>
                                <th className="py-3.5 px-4">Ganancia est.</th>
                                <th className="py-3.5 px-4">Pago</th>
                                <th className="py-3.5 px-4">Despacho</th>
                                <th className="py-3.5 px-4 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {orders.map((o) => {
                                const expanded = expandedId === o.id;
                                const supplierCost = supplierCostOf(o);
                                const profit = o.total_cop - supplierCost;
                                return (
                                    <Fragment key={o.id}>
                                        <tr className={expanded ? "bg-primary/10" : "hover:bg-white/5"}>
                                            <td className="py-3.5 px-4 font-mono font-bold text-white">
                                                #{o.ref}
                                                <div className="text-[10px] text-muted font-normal mt-0.5">
                                                    {new Date(o.created_at).toLocaleString("es-CO")}
                                                </div>
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <div className="font-semibold text-white">{o.customer_name}</div>
                                                <div className="text-[11px] text-muted">
                                                    {o.city} • {o.customer_phone}
                                                </div>
                                            </td>
                                            <td className="py-3.5 px-4 text-muted max-w-[200px]">
                                                <span className="line-clamp-2">
                                                    {o.items.map((i) => `${i.name} (x${i.quantity})`).join(", ")}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 font-bold text-white">{formatCOP(o.total_cop)}</td>
                                            <td className="py-3.5 px-4 font-mono">
                                                {supplierCost > 0 ? (
                                                    <span className={profit >= 0 ? "text-green-400" : "text-red-300"}>
                                                        {profit >= 0 ? "+" : ""}
                                                        {formatCOP(profit)}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted">—</span>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${paymentBadge(o.payment_status)}`}>
                                                    {PAYMENT_STATUS_LABELS[o.payment_status]}
                                                </span>
                                                {o.payment_status === "payment_review" && (
                                                    <div className="flex items-center gap-1 text-[10px] text-red-300 mt-1">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Monto no coincide
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/10 text-white">
                                                    {FULFILLMENT_STATUS_LABELS[o.fulfillment_status]}
                                                </span>
                                                {o.tracking_number && (
                                                    <div className="text-[10px] font-mono text-accent mt-1">
                                                        {o.carrier ? `${o.carrier} · ` : ""}
                                                        {o.tracking_number}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-4 text-right">
                                                <button
                                                    onClick={() => {
                                                        setExpandedId(expanded ? null : o.id);
                                                        setEditStatus("");
                                                        setEditTracking(o.tracking_number ?? "");
                                                        setEditCarrier(o.carrier ?? "Coordinadora");
                                                        setActionError("");
                                                    }}
                                                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1"
                                                >
                                                    Gestionar
                                                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                                </button>
                                            </td>
                                        </tr>
                                        {expanded && (
                                            <tr key={`${o.id}-detail`} className="bg-surface/60">
                                                <td colSpan={8} className="py-4 px-4">
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                        {/* Customer + items */}
                                                        <div className="space-y-3 text-xs">
                                                            <div className="p-3.5 rounded-xl bg-surface-card border border-white/5">
                                                                <h5 className="font-semibold text-white mb-2">Destinatario</h5>
                                                                <p className="text-muted">
                                                                    {o.customer_name} • {o.customer_phone}
                                                                    <br />
                                                                    {o.customer_email}
                                                                    <br />
                                                                    {o.address}, {o.city}
                                                                    {o.department ? `, ${o.department}` : ""}
                                                                    {o.notes ? (
                                                                        <>
                                                                            <br />
                                                                            Notas: {o.notes}
                                                                        </>
                                                                    ) : null}
                                                                </p>
                                                            </div>
                                                            <div className="p-3.5 rounded-xl bg-surface-card border border-white/5">
                                                                <h5 className="font-semibold text-white mb-2">Detalle</h5>
                                                                {o.items.map((i) => (
                                                                    <div key={i.id} className="flex justify-between text-muted py-0.5">
                                                                        <span>
                                                                            {i.name} × {i.quantity}
                                                                        </span>
                                                                        <span className="text-white">
                                                                            {formatCOP(i.unit_price_cop * i.quantity)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                                <div className="pt-2 mt-2 border-t border-white/10 space-y-0.5 text-muted">
                                                                    <div className="flex justify-between">
                                                                        <span>Subtotal</span>
                                                                        <span className="text-white">{formatCOP(o.subtotal_cop)}</span>
                                                                    </div>
                                                                    {o.discount_cop > 0 && (
                                                                        <div className="flex justify-between text-green-400">
                                                                            <span>Descuento{o.coupon_code ? ` (${o.coupon_code})` : ""}</span>
                                                                            <span>-{formatCOP(o.discount_cop)}</span>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex justify-between">
                                                                        <span>Envío</span>
                                                                        <span className="text-white">{formatCOP(o.shipping_cop)}</span>
                                                                    </div>
                                                                    <div className="flex justify-between font-bold text-white">
                                                                        <span>Total</span>
                                                                        <span>{formatCOP(o.total_cop)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="p-3.5 rounded-xl bg-surface-card border border-white/5">
                                                                <h5 className="font-semibold text-white mb-2">Historial</h5>
                                                                <div className="space-y-1.5">
                                                                    {o.events
                                                                        .slice()
                                                                        .sort((a, b) => b.created_at.localeCompare(a.created_at))
                                                                        .map((e) => (
                                                                            <div key={e.id} className="flex justify-between gap-2 text-[11px]">
                                                                                <span className="text-white">{e.label}</span>
                                                                                <span className="text-muted font-mono shrink-0">
                                                                                    {new Date(e.created_at).toLocaleString("es-CO")}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Actions */}
                                                        <div className="space-y-3">
                                                            {(o.payment_status === "paid" ||
                                                                o.payment_status === "payment_failed" ||
                                                                o.payment_status === "pending_payment") &&
                                                                nextStatuses(o.fulfillment_status).length > 0 && (
                                                                    <div className="p-4 rounded-xl bg-surface-card border border-primary/20 space-y-3">
                                                                        <h5 className="font-semibold text-white text-xs flex items-center gap-2">
                                                                            <Truck className="w-4 h-4 text-primary" />
                                                                            Actualizar despacho
                                                                        </h5>
                                                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                                            <select
                                                                                value={editStatus}
                                                                                onChange={(e) => setEditStatus(e.target.value as FulfillmentStatus)}
                                                                                className={inputClass}
                                                                            >
                                                                                <option value="">Estado…</option>
                                                                                {nextStatuses(o.fulfillment_status).map((s) => (
                                                                                    <option key={s} value={s}>
                                                                                        {FULFILLMENT_STATUS_LABELS[s]}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                            <input
                                                                                type="text"
                                                                                value={editTracking}
                                                                                onChange={(e) => setEditTracking(e.target.value)}
                                                                                placeholder="Número de guía"
                                                                                className={`${inputClass} font-mono`}
                                                                            />
                                                                            <select
                                                                                value={editCarrier}
                                                                                onChange={(e) => setEditCarrier(e.target.value)}
                                                                                className={inputClass}
                                                                            >
                                                                                {CARRIERS.map((c) => (
                                                                                    <option key={c} value={c}>
                                                                                        {c}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => handleSave(o)}
                                                                            disabled={saving || (!editStatus && !editTracking.trim())}
                                                                            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold disabled:opacity-50"
                                                                        >
                                                                            {saving ? "Guardando…" : "Guardar cambios"}
                                                                        </button>
                                                                    </div>
                                                                )}

                                                            {o.payment_status === "paid" && hasSupplierItems(o) && (
                                                                <div className="p-4 rounded-xl bg-surface-card border border-white/10 space-y-2">
                                                                    <h5 className="font-semibold text-white text-xs flex items-center gap-2">
                                                                        <PackageCheck className="w-4 h-4 text-secondary" />
                                                                        Pedido a proveedor
                                                                    </h5>
                                                                    {o.supplier_order_status === "submitted" && (
                                                                        <p className="text-[11px] text-green-300">
                                                                            Enviado{o.supplier_order_id ? `: ${o.supplier_order_id}` : ""}
                                                                        </p>
                                                                    )}
                                                                    {o.supplier_order_status === "partial" && (
                                                                        <p className="text-[11px] text-amber-300">
                                                                            Parcial: {o.supplier_order_id ?? "sin ref."}
                                                                        </p>
                                                                    )}
                                                                    {o.supplier_order_error && (
                                                                        <p className="text-[11px] text-red-300">
                                                                            {o.supplier_order_error}
                                                                        </p>
                                                                    )}
                                                                    {o.supplier_order_status !== "submitted" && (
                                                                        <button
                                                                            onClick={() => void placeSupplierOrder(o)}
                                                                            disabled={fulfilling === o.id}
                                                                            className="px-3 py-2 rounded-xl bg-secondary/20 hover:bg-secondary/30 text-secondary text-xs font-semibold border border-secondary/30 disabled:opacity-50"
                                                                        >
                                                                            {fulfilling === o.id
                                                                                ? "Enviando…"
                                                                                : o.supplier_order_status === "failed" ||
                                                                                    o.supplier_order_status === "partial"
                                                                                  ? "Reintentar envío"
                                                                                  : "Enviar a proveedor"}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {o.fulfillment_status === "awaiting_payment" && (
                                                                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                                                                    Sin pago confirmado no se puede avanzar el despacho.
                                                                </p>
                                                            )}
                                                            {o.payment_status === "payment_review" && (
                                                                <p className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                                                                    La pasarela reportó un monto distinto al del pedido. Verifica la
                                                                    transacción en Wompi antes de gestionar el despacho.
                                                                </p>
                                                            )}

                                                            <div className="flex gap-2">
                                                                {(o.payment_status === "pending_payment" ||
                                                                    o.payment_status === "payment_failed") && (
                                                                    <button
                                                                        onClick={() => void patch(o.id, { action: "cancel" }, o.updated_at)}
                                                                        disabled={saving}
                                                                        className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 disabled:opacity-50"
                                                                    >
                                                                        Cancelar pedido
                                                                    </button>
                                                                )}
                                                                {o.payment_status === "paid" && (
                                                                    <button
                                                                        onClick={() => void patch(o.id, { action: "refund" }, o.updated_at)}
                                                                        disabled={saving}
                                                                        className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 disabled:opacity-50"
                                                                    >
                                                                        Marcar reembolsado
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {o.payment_status === "paid" && (
                                                                <p className="text-[10px] text-muted">
                                                                    Los reembolsos se ejecutan en el panel de Wompi; aquí solo se registra
                                                                    el estado.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {!loading && orders.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-10 text-center text-muted text-xs">
                                        No hay pedidos{filter ? " con este filtro" : ""} todavía.
                                    </td>
                                </tr>
                            )}
                            {loading && (
                                <tr>
                                    <td colSpan={8} className="py-10 text-center text-muted text-xs animate-pulse">
                                        Cargando pedidos…
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ReviewsPanel />
        </div>
    );
}
