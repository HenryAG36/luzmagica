"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, Star, XCircle } from "lucide-react";
import type { AdminReviewRow } from "@/lib/orders/repository";

const STATUS_LABELS: Record<string, string> = {
    pending: "Pendiente",
    approved: "Aprobada",
    rejected: "Rechazada",
};

// Moderation queue: reviews stay invisible on the storefront until an
// operator approves them.
export default function ReviewsPanel() {
    const [reviews, setReviews] = useState<AdminReviewRow[]>([]);
    const [filter, setFilter] = useState("pending");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/admin/reviews?status=${filter}`);
            if (!res.ok) {
                setError("No se pudieron cargar las reseñas.");
                setReviews([]);
                return;
            }
            const body = await res.json();
            setReviews(body.reviews ?? []);
        } catch {
            setError("Error de red al cargar las reseñas.");
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => {
        void load();
    }, [load]);

    const moderate = async (id: string, status: "approved" | "rejected") => {
        setBusyId(id);
        setError("");
        try {
            const res = await fetch("/api/admin/reviews", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error || "No se pudo actualizar la reseña.");
                return;
            }
            await load();
        } catch {
            setError("Error de red.");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="glass rounded-3xl p-6 border border-white/10">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h4 className="font-heading text-base font-bold text-white">Reseñas de clientes</h4>
                    <p className="text-[11px] text-muted">
                        Solo las reseñas aprobadas aparecen en la página del producto.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white"
                    >
                        <option value="pending">Pendientes</option>
                        <option value="approved">Aprobadas</option>
                        <option value="rejected">Rechazadas</option>
                    </select>
                    <button
                        onClick={() => void load()}
                        className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs border border-white/10"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {error && (
                <p role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 mb-3">
                    {error}
                </p>
            )}

            {loading ? (
                <p className="text-xs text-muted py-6 text-center animate-pulse">Cargando reseñas…</p>
            ) : reviews.length === 0 ? (
                <p className="text-xs text-muted py-6 text-center">
                    No hay reseñas {STATUS_LABELS[filter].toLowerCase()}s.
                </p>
            ) : (
                <div className="space-y-3">
                    {reviews.map((r) => (
                        <div key={r.id} className="p-4 rounded-2xl bg-surface-card border border-white/5">
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="flex items-center gap-0.5">
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <Star
                                                key={n}
                                                className={`w-3.5 h-3.5 ${n <= r.rating ? "text-amber-400 fill-amber-400" : "text-white/20"}`}
                                            />
                                        ))}
                                    </span>
                                    <span className="font-semibold text-white">
                                        {r.product_name ?? "Producto eliminado"}
                                    </span>
                                    {r.order_ref && <span className="font-mono text-muted">#{r.order_ref}</span>}
                                </div>
                                <span className="text-[10px] text-muted">
                                    {new Date(r.created_at).toLocaleString("es-CO")}
                                </span>
                            </div>
                            <p className="text-xs text-muted mb-3">{r.comment}</p>
                            {r.status === "pending" && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => void moderate(r.id, "approved")}
                                        disabled={busyId === r.id}
                                        className="px-3 py-1.5 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-300 text-xs font-semibold border border-green-500/20 flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Aprobar
                                    </button>
                                    <button
                                        onClick={() => void moderate(r.id, "rejected")}
                                        disabled={busyId === r.id}
                                        className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <XCircle className="w-3.5 h-3.5" />
                                        Rechazar
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
