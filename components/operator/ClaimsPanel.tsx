"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { CLAIM_REASON_LABELS, CLAIM_STATUS_LABELS, type ClaimStatus, type SupplierClaimRow } from "@/lib/orders/types";

interface AdminClaim extends SupplierClaimRow {
    order_ref: string | null;
    product_name: string | null;
    customer_name: string | null;
    supplier_order_id: string | null;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
    { value: "", label: "Todas" },
    { value: "draft", label: "En revisión" },
    { value: "submitted", label: "Enviadas" },
    { value: "provider_responded", label: "Proveedor respondió" },
    { value: "resolved", label: "Resueltas" },
    { value: "rejected", label: "Rechazadas" },
];

const PROVIDER_LABELS: Record<string, string> = {
    aliexpress_ds: "AliExpress",
    cjdropshipping: "CJ",
    manual: "Manual",
};

function statusBadge(status: ClaimStatus) {
    switch (status) {
        case "draft":
            return "bg-amber-500/20 text-amber-300 border-amber-500/30";
        case "submitted":
            return "bg-blue-500/20 text-blue-300 border-blue-500/30";
        case "provider_responded":
            return "bg-purple-500/20 text-purple-300 border-purple-500/30";
        case "resolved":
            return "bg-green-500/20 text-green-300 border-green-500/30";
        default:
            return "bg-white/10 text-muted border-white/10";
    }
}

export default function ClaimsPanel() {
    const [claims, setClaims] = useState<AdminClaim[]>([]);
    const [filter, setFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [evidence, setEvidence] = useState<Record<string, string[]>>({});
    const [actionMsg, setActionMsg] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [guide, setGuide] = useState<string[] | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const url = filter ? `/api/admin/claims?status=${filter}` : "/api/admin/claims";
            const res = await fetch(url);
            if (!res.ok) {
                setError("No se pudieron cargar los reclamos.");
                return;
            }
            const body = await res.json();
            setClaims(body.claims ?? []);
        } catch {
            setError("Error de red al cargar reclamos.");
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => {
        void load();
    }, [load]);

    const loadEvidence = async (claim: AdminClaim) => {
        if (claim.evidence_paths.length === 0 || evidence[claim.id]) return;
        try {
            const res = await fetch(`/api/admin/claims/${claim.id}/evidence`);
            const body = await res.json().catch(() => ({}));
            setEvidence((prev) => ({ ...prev, [claim.id]: body.urls ?? [] }));
        } catch {
            // evidence is best-effort
        }
    };

    const act = async (claim: AdminClaim, fn: () => Promise<{ ok: boolean; msg: string }>) => {
        setBusy(claim.id);
        setActionMsg((prev) => ({ ...prev, [claim.id]: "" }));
        try {
            const result = await fn();
            setActionMsg((prev) => ({ ...prev, [claim.id]: result.msg }));
            if (result.ok) await load();
        } catch {
            setActionMsg((prev) => ({ ...prev, [claim.id]: "Error de red." }));
        } finally {
            setBusy(null);
        }
    };

    const submitClaim = (claim: AdminClaim) =>
        act(claim, async () => {
            const res = await fetch(`/api/admin/claims/${claim.id}/submit`, { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, msg: body.error || "No se pudo enviar." };
            if (body.guide) {
                setGuide(body.guide as string[]);
                return { ok: false, msg: "Reclamo manual — sigue la guía mostrada." };
            }
            return { ok: true, msg: "Disputa enviada al proveedor." };
        });

    const setStatus = (claim: AdminClaim, status: string) =>
        act(claim, async () => {
            const res = await fetch(`/api/admin/claims/${claim.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            const body = await res.json().catch(() => ({}));
            return res.ok
                ? { ok: true, msg: "Estado actualizado." }
                : { ok: false, msg: body.error || "No se pudo actualizar." };
        });

    const attachFiles = async (claim: AdminClaim, files: FileList | null) => {
        if (!files || files.length === 0) return;
        const form = new FormData();
        for (const f of Array.from(files)) form.append("files", f);
        await act(claim, async () => {
            const res = await fetch(`/api/admin/claims/${claim.id}/evidence`, {
                method: "POST",
                body: form,
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setEvidence((prev) => {
                    const next = { ...prev };
                    delete next[claim.id];
                    return next;
                });
                return { ok: true, msg: "Evidencia adjuntada." };
            }
            return { ok: false, msg: body.error || "No se pudo adjuntar." };
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-white flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-amber-400" />
                        Reclamos de producto
                    </h3>
                    <p className="text-xs text-muted">
                        Evidencias de clientes y disputas con proveedores. CJ se envía por API; AliExpress es manual guiado.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white"
                    >
                        {STATUS_FILTERS.map((f) => (
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

            {error && (
                <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
                    {error}
                </p>
            )}

            {guide && (
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-200 space-y-2">
                    <div className="flex justify-between items-center">
                        <h5 className="font-semibold">Guía manual (AliExpress no tiene API de disputas)</h5>
                        <button onClick={() => setGuide(null)} className="text-blue-300 hover:text-white">
                            Cerrar
                        </button>
                    </div>
                    <ol className="list-decimal list-inside space-y-1">
                        {guide.map((step, i) => (
                            <li key={i}>{step}</li>
                        ))}
                    </ol>
                </div>
            )}

            <div className="glass rounded-3xl overflow-hidden border border-white/10">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-surface border-b border-white/10 text-muted uppercase tracking-wider text-[10px]">
                            <tr>
                                <th className="py-3 px-4">Pedido</th>
                                <th className="py-3 px-4">Producto</th>
                                <th className="py-3 px-4">Motivo</th>
                                <th className="py-3 px-4">Proveedor</th>
                                <th className="py-3 px-4">Estado</th>
                                <th className="py-3 px-4">Fecha</th>
                                <th className="py-3 px-4 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {claims.map((c) => (
                                <tr key={c.id} className="hover:bg-white/5 align-top">
                                    <td className="py-3 px-4 font-mono font-bold text-white">
                                        #{c.order_ref ?? "—"}
                                        <div className="text-[10px] text-muted font-normal">{c.customer_name ?? ""}</div>
                                    </td>
                                    <td className="py-3 px-4 text-muted max-w-[200px]">
                                        <span className="line-clamp-2">{c.product_name ?? c.order_item_id}</span>
                                    </td>
                                    <td className="py-3 px-4 text-white">{CLAIM_REASON_LABELS[c.reason]}</td>
                                    <td className="py-3 px-4 text-muted">{PROVIDER_LABELS[c.provider] ?? c.provider}</td>
                                    <td className="py-3 px-4">
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${statusBadge(c.status)}`}>
                                            {CLAIM_STATUS_LABELS[c.status]}
                                        </span>
                                        {c.provider_status && (
                                            <div className="text-[10px] text-muted mt-1">{c.provider_status}</div>
                                        )}
                                    </td>
                                    <td className="py-3 px-4 text-muted">
                                        {new Date(c.created_at).toLocaleDateString("es-CO")}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <button
                                            onClick={() => {
                                                setExpandedId(expandedId === c.id ? null : c.id);
                                                if (expandedId !== c.id) void loadEvidence(c);
                                            }}
                                            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
                                        >
                                            {expandedId === c.id ? "Cerrar" : "Ver"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {!loading && claims.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-muted text-xs">
                                        No hay reclamos{filter ? " con este filtro" : ""}.
                                    </td>
                                </tr>
                            )}
                            {loading && (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-muted text-xs animate-pulse">
                                        Cargando reclamos…
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {expandedId &&
                claims
                    .filter((c) => c.id === expandedId)
                    .map((c) => (
                        <div key={c.id} className="glass rounded-3xl p-6 border border-white/10 space-y-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-semibold text-white text-sm">
                                        Reclamo #{c.order_ref} — {CLAIM_REASON_LABELS[c.reason]}
                                    </h4>
                                    <p className="text-[11px] text-muted">
                                        {c.created_by === "customer" ? "Enviado por el cliente" : "Creado por el operador"} •{" "}
                                        {new Date(c.created_at).toLocaleString("es-CO")}
                                    </p>
                                </div>
                            </div>
                            <p className="text-xs text-muted whitespace-pre-wrap">{c.description}</p>

                            <div>
                                <h5 className="text-xs font-semibold text-white mb-2">
                                    Evidencias ({c.evidence_paths.length})
                                </h5>
                                {evidence[c.id]?.length ? (
                                    <div className="flex gap-2 flex-wrap">
                                        {evidence[c.id].map((url, i) => (
                                            <a
                                                key={i}
                                                href={url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] border border-white/10"
                                            >
                                                Evidencia {i + 1}
                                            </a>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-muted">Sin evidencias adjuntas.</p>
                                )}
                                <label className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-[11px] font-semibold border border-white/10 cursor-pointer">
                                    <Upload className="w-3 h-3" />
                                    Adjuntar evidencia
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                                        className="hidden"
                                        onChange={(e) => void attachFiles(c, e.target.files)}
                                    />
                                </label>
                            </div>

                            {actionMsg[c.id] && (
                                <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                                    {actionMsg[c.id]}
                                </p>
                            )}

                            <div className="flex gap-2 flex-wrap">
                                {c.status === "draft" && (
                                    <button
                                        onClick={() => void submitClaim(c)}
                                        disabled={busy === c.id}
                                        className="px-3 py-2 rounded-xl bg-secondary/20 hover:bg-secondary/30 text-secondary text-xs font-semibold border border-secondary/30 disabled:opacity-50"
                                    >
                                        {busy === c.id ? "Enviando…" : c.provider === "cjdropshipping" ? "Enviar disputa a CJ" : "Ver guía de disputa"}
                                    </button>
                                )}
                                {(c.status === "submitted" || c.status === "provider_responded") && (
                                    <button
                                        onClick={() => void setStatus(c, "resolved")}
                                        disabled={busy === c.id}
                                        className="px-3 py-2 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-300 text-xs font-semibold border border-green-500/30 disabled:opacity-50"
                                    >
                                        Marcar resuelta
                                    </button>
                                )}
                                {c.status === "draft" && (
                                    <button
                                        onClick={() => void setStatus(c, "submitted")}
                                        disabled={busy === c.id}
                                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 disabled:opacity-50"
                                    >
                                        Marcar enviada (manual)
                                    </button>
                                )}
                                {c.status !== "resolved" && c.status !== "cancelled" && (
                                    <>
                                        <button
                                            onClick={() => void setStatus(c, "rejected")}
                                            disabled={busy === c.id}
                                            className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/20 disabled:opacity-50"
                                        >
                                            Rechazar
                                        </button>
                                        <button
                                            onClick={() => void setStatus(c, "cancelled")}
                                            disabled={busy === c.id}
                                            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted text-xs font-semibold border border-white/10 disabled:opacity-50"
                                        >
                                            Cancelar
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
        </div>
    );
}
