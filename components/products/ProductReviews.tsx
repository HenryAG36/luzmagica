"use client";

import { useEffect, useState } from "react";
import { Star, BadgeCheck } from "lucide-react";
import type { PublicReview } from "@/lib/orders/types";

// Approved, order-linked reviews only — the API never returns pending or
// rejected entries, so nothing unverified reaches the storefront.
export default function ProductReviews({ productId }: { productId: string }) {
    const [reviews, setReviews] = useState<PublicReview[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/products/${encodeURIComponent(productId)}/reviews`)
            .then((r) => (r.ok ? r.json() : { reviews: [] }))
            .then((body: { reviews?: PublicReview[] }) => {
                if (!cancelled) setReviews(body.reviews ?? []);
            })
            .catch(() => {
                if (!cancelled) setReviews([]);
            });
        return () => {
            cancelled = true;
        };
    }, [productId]);

    if (reviews === null || reviews.length === 0) return null;

    const avg = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;

    return (
        <div className="glass rounded-3xl p-6 md:p-8 mt-8">
            <div className="flex items-center gap-3 mb-5">
                <h3 className="font-heading text-lg font-bold text-white">Reseñas verificadas</h3>
                <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Star className="w-4 h-4 fill-amber-400" />
                    {avg.toFixed(1)} · {reviews.length} {reviews.length === 1 ? "reseña" : "reseñas"}
                </span>
            </div>
            <div className="space-y-4">
                {reviews.map((review, i) => (
                    <div key={i} className="p-4 rounded-2xl bg-surface-card border border-white/5">
                        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white">{review.reviewerName}</span>
                                <span className="flex items-center gap-0.5 text-[11px] text-green-300">
                                    <BadgeCheck className="w-3.5 h-3.5" />
                                    Compra verificada
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <Star
                                        key={n}
                                        className={`w-3.5 h-3.5 ${n <= review.rating ? "text-amber-400 fill-amber-400" : "text-white/20"}`}
                                    />
                                ))}
                            </div>
                        </div>
                        <p className="text-xs text-muted leading-relaxed">{review.comment}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
