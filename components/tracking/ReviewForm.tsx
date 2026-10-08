"use client";

import { useState } from "react";
import { Star, CheckCircle2 } from "lucide-react";
import type { PublicOrder } from "@/lib/orders/types";

interface Props {
    order: PublicOrder;
    contact: string;
}

interface DraftState {
    rating: number;
    comment: string;
    submitting: boolean;
    done: boolean;
    error: string | null;
}

// Per-item review form shown on the tracking page once an order is
// delivered. Auth is the same ref + contact pair used for lookup; the
// server re-verifies it. Submitted reviews stay pending until moderated.
export default function ReviewForm({ order, contact }: Props) {
    const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

    const reviewable = order.items.filter((i) => !order.reviewedProductIds.includes(i.productId));
    if (order.fulfillmentStatus !== "delivered" || reviewable.length === 0) return null;

    const emptyDraft = (): DraftState => ({
        rating: 5,
        comment: "",
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
        const draft = drafts[productId] ?? { rating: 5, comment: "" };
        if (draft.submitting) return;
        update(productId, { submitting: true, error: null });
        try {
            const res = await fetch("/api/orders/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ref: order.ref,
                    contact,
                    productId,
                    rating: draft.rating,
                    comment: draft.comment.trim(),
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                update(productId, { submitting: false, done: true });
            } else {
                update(productId, {
                    submitting: false,
                    error: typeof body.error === "string" ? body.error : "No se pudo enviar la reseña.",
                });
            }
        } catch {
            update(productId, { submitting: false, error: "Error de red. Intenta de nuevo." });
        }
    };

    return (
        <div className="glass rounded-3xl p-6 md:p-8">
            <h3 className="font-heading text-lg font-bold text-white mb-2">Califica tu compra</h3>
            <p className="text-xs text-muted mb-6">
                Las reseñas se publican con tu nombre abreviado tras una revisión del equipo.
            </p>
            <div className="space-y-4">
                {reviewable.map((item) => {
                    const draft = drafts[item.productId] ?? emptyDraft();
                    if (draft.done) {
                        return (
                            <div
                                key={item.productId}
                                className="p-4 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center gap-2 text-sm text-green-300"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                Reseña enviada para «{item.name}» — pendiente de aprobación.
                            </div>
                        );
                    }
                    return (
                        <div key={item.productId} className="p-4 rounded-2xl bg-surface-card border border-white/5 space-y-3">
                            <h4 className="text-sm font-semibold text-white">{item.name}</h4>
                            <div className="flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => update(item.productId, { rating: n })}
                                        aria-label={`${n} estrellas`}
                                        className="p-0.5"
                                    >
                                        <Star
                                            className={`w-5 h-5 ${
                                                n <= draft.rating ? "text-amber-400 fill-amber-400" : "text-white/20"
                                            }`}
                                        />
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={draft.comment}
                                onChange={(e) => update(item.productId, { comment: e.target.value.slice(0, 1000) })}
                                placeholder="¿Cómo fue el producto y la entrega?"
                                rows={3}
                                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder-muted focus:outline-none focus:border-primary/50 resize-none"
                            />
                            {draft.error && <p className="text-xs text-red-300">{draft.error}</p>}
                            <button
                                type="button"
                                onClick={() => void submit(item.productId)}
                                disabled={draft.submitting || draft.comment.trim().length === 0}
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                                {draft.submitting ? "Enviando…" : "Enviar reseña"}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
