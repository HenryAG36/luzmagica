"use client";

import { useState } from "react";
import { ShieldAlert, CheckCircle2 } from "lucide-react";
import {
    CLAIM_REASON_LABELS,
    CLAIM_STATUS_LABELS,
    type ClaimReason,
    type PublicOrder,
} from "@/lib/orders/types";

interface Props {
    order: PublicOrder;
    contact: string;
}

interface DraftState {
    reason: ClaimReason;
    description: string;
    files: File[];
    submitting: boolean;
    done: boolean;
    error: string | null;
}

const CLAIMABLE = new Set([
    "international_transit",
    "customs_cleared",
    "local_delivery",
    "delivered",
]);

// Faulty-product claim form on the tracking page. Auth is the same
// ref + contact pair as the lookup; the server re-verifies it. Claims land
// as drafts for operator review — nothing reaches the supplier yet.
export default function ClaimForm({ order, contact }: Props) {
    const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
    const [open, setOpen] = useState(false);

    if (order.paymentStatus !== "paid" || !CLAIMABLE.has(order.fulfillmentStatus)) return null;

    const claimable = order.items.filter(
        (i) => !order.claims.some((c) => c.productId === i.productId && c.status !== "cancelled" && c.status !== "rejected")
    );

    const emptyDraft = (): DraftState => ({
        reason: "defective",
        description: "",
        files: [],
        submitting: false,
        done: false,
        error: null,
    });
    const update = (productId: string, patch: Partial<DraftState>) => {
        setDrafts((prev) => ({
            ...prev,
            [productId]: { ...(prev[productId] ?? emptyDraft()), ...patch },
        }));
    };

    const submit = async (productId: string) => {
        const draft = drafts[productId] ?? emptyDraft();
        if (draft.submitting) return;
        update(productId, { submitting: true, error: null });
        try {
            const form = new FormData();
            form.set("ref", order.ref);
            form.set("contact", contact);
            form.set("productId", productId);
            form.set("reason", draft.reason);
            form.set("description", draft.description.trim());
            for (const f of draft.files.slice(0, 3)) form.append("files", f);
            const res = await fetch("/api/orders/claims", { method: "POST", body: form });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                update(productId, { submitting: false, done: true });
            } else {
                update(productId, {
                    submitting: false,
                    error: typeof body.error === "string" ? body.error : "No se pudo enviar el reclamo.",
                });
            }
        } catch {
            update(productId, { submitting: false, error: "Error de red. Intenta de nuevo." });
        }
    };

    return (
        <div className="glass rounded-3xl p-6 md:p-8">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between text-left"
            >
                <h3 className="font-heading text-lg font-bold text-white flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-400" />
                    <span>¿Problema con tu pedido?</span>
                </h3>
                <span className="text-xs text-muted">{open ? "Cerrar" : "Reportar"}</span>
            </button>

            {order.claims.length > 0 && (
                <div className="mt-4 space-y-2">
                    {order.claims.map((c, i) => (
                        <div key={i} className="flex justify-between text-xs p-3 rounded-xl bg-surface-card border border-white/5">
                            <span className="text-muted">{CLAIM_REASON_LABELS[c.reason]}</span>
                            <span className="text-white font-semibold">{CLAIM_STATUS_LABELS[c.status]}</span>
                        </div>
                    ))}
                </div>
            )}

            {open && claimable.length > 0 && (
                <div className="mt-5 space-y-4">
                    <p className="text-xs text-muted">
                        Describe el problema y adjunta fotos o video si el producto llegó defectuoso, dañado o equivocado.
                    </p>
                    {claimable.map((item) => {
                        const draft = drafts[item.productId] ?? emptyDraft();
                        if (draft.done) {
                            return (
                                <div
                                    key={item.productId}
                                    className="p-4 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center gap-2 text-sm text-green-300"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Reclamo recibido para «{item.name}» — lo revisamos y te contactamos.
                                </div>
                            );
                        }
                        return (
                            <div key={item.productId} className="p-4 rounded-2xl bg-surface-card border border-white/5 space-y-3">
                                <h4 className="text-sm font-semibold text-white">{item.name}</h4>
                                <select
                                    value={draft.reason}
                                    onChange={(e) => update(item.productId, { reason: e.target.value as ClaimReason })}
                                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                                >
                                    {Object.entries(CLAIM_REASON_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                                <textarea
                                    value={draft.description}
                                    onChange={(e) => update(item.productId, { description: e.target.value.slice(0, 2000) })}
                                    placeholder="Describe el problema (mínimo 10 caracteres)"
                                    rows={3}
                                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 resize-none"
                                />
                                <div>
                                    <label className="block text-xs text-muted mb-1.5">
                                        Evidencia (fotos o video, máx. 3 archivos de 5MB)
                                    </label>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                                        onChange={(e) =>
                                            update(item.productId, { files: Array.from(e.target.files ?? []).slice(0, 3) })
                                        }
                                        className="w-full text-xs text-muted file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary/20 file:text-primary file:text-xs file:font-semibold"
                                    />
                                </div>
                                {draft.error && <p className="text-xs text-red-300">{draft.error}</p>}
                                <button
                                    type="button"
                                    onClick={() => void submit(item.productId)}
                                    disabled={draft.submitting || draft.description.trim().length < 10}
                                    className="px-4 py-2 rounded-xl bg-amber-500/80 hover:bg-amber-500 text-black text-xs font-bold transition-colors disabled:opacity-50"
                                >
                                    {draft.submitting ? "Enviando…" : "Enviar reclamo"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            {open && claimable.length === 0 && (
                <p className="mt-4 text-xs text-muted">
                    Ya registraste un reclamo para todos los productos de este pedido.
                </p>
            )}
        </div>
    );
}
