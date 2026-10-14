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
        <div className="glass rounded-3xl p-6 md:p-8">
            <div className="mb-5 flex items-center gap-3">
                <h3 className="font-heading text-xl font-semibold">Reseñas verificadas</h3>
                <span className="flex items-center gap-1 text-xs text-muted">
                    <Star className="h-4 w-4 fill-accent text-accent" aria-hidden />
                    <span className="font-semibold text-foreground">{avg.toFixed(1)}</span>
                    <span className="sr-only">de 5,</span>
                    {reviews.length} {reviews.length === 1 ? "reseña" : "reseñas"}
                </span>
            </div>
            <div className="space-y-4">
                {reviews.map((review, i) => (
                    <div key={i} className="rounded-2xl border border-black/10 bg-surface p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold">{review.reviewerName}</span>
                                <span className="flex items-center gap-0.5 text-[11px] text-success">
                                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                                    Compra verificada
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5" aria-label={`${review.rating} de 5 estrellas`}>
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <Star
                                        key={n}
                                        aria-hidden
                                        className={`h-3.5 w-3.5 ${n <= review.rating ? "fill-accent text-accent" : "text-black/20"}`}
                                    />
                                ))}
                            </div>
                        </div>
                        <p className="text-xs leading-relaxed text-muted">{review.comment}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
