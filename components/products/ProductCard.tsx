"use client";

import Link from "next/link";
import { ShoppingCart, Star } from "lucide-react";
import { Product } from "@/lib/types";
import { formatCOP } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import ProductImage from "@/components/common/ProductImage";

interface ProductCardProps {
    product: Product;
    index?: number;
}

function validDiscount(product: Product): number {
    const original = product.originalPrice;
    if (typeof original !== "number" || !Number.isFinite(original)) return 0;
    if (original <= product.price || product.price <= 0) return 0;
    return Math.round(((original - product.price) / original) * 100);
}

export default function ProductCard({ product }: ProductCardProps) {
    const addItem = useCartStore((s) => s.addItem);
    const discount = validDiscount(product);
    const savings = discount > 0 ? product.originalPrice! - product.price : 0;
    const soldOut = !Number.isFinite(product.stock) || product.stock <= 0;
    const hasRating =
        typeof product.reviewsCount === "number" &&
        product.reviewsCount > 0 &&
        typeof product.reviewsAvg === "number" &&
        Number.isFinite(product.reviewsAvg);

    return (
        <div className="group relative">
            <Link href={`/products/${product.id}`} className="block">
                <div className="glass overflow-hidden rounded-2xl transition-shadow hover:shadow-md">
                    {/* Image */}
                    <div className="relative aspect-square overflow-hidden bg-surface-light">
                        <ProductImage
                            src={product.images[0]}
                            alt={product.name}
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                            className="motion-product-image"
                        />

                        {soldOut ? (
                            <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white">
                                Agotado
                            </span>
                        ) : discount > 0 ? (
                            <span className="absolute left-3 top-3 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent-dark">
                                -{discount}%
                            </span>
                        ) : product.badge === "new" ? (
                            <span className="absolute left-3 top-3 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-white">
                                Nuevo
                            </span>
                        ) : null}
                    </div>

                    {/* Info */}
                    <div className="p-4 pb-2">
                        <h3 className="mb-1.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-foreground transition-colors group-hover:text-accent-dark">
                            {product.name}
                        </h3>

                        {hasRating && (
                            <p className="mb-1.5 flex items-center gap-1 text-xs text-muted">
                                <Star className="h-3.5 w-3.5 fill-accent text-accent" aria-hidden />
                                <span className="font-semibold text-foreground">
                                    {product.reviewsAvg!.toFixed(1)}
                                </span>
                                <span className="sr-only">de 5 estrellas,</span>
                                <span aria-hidden>·</span>
                                {product.reviewsCount} {product.reviewsCount === 1 ? "reseña" : "reseñas"}
                            </p>
                        )}

                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-base font-bold text-foreground">
                                {formatCOP(product.price)}
                            </span>
                            {savings > 0 && (
                                <span className="text-xs text-muted line-through">
                                    {formatCOP(product.originalPrice!)}
                                </span>
                            )}
                        </div>
                        {savings > 0 && (
                            <p className="mt-0.5 text-xs font-medium text-accent-dark">
                                Ahorras {formatCOP(savings)}
                            </p>
                        )}
                        {product.shippingQuoteRequired && (
                            <>
                                <p className="mt-1 text-[10px] text-muted">
                                    {product.shippingEstimateCOP != null
                                        ? `+${formatCOP(product.shippingEstimateCOP)} envío intl. est. por unidad${product.shippingEstimateCity ? ` a ${product.shippingEstimateCity}` : ""}`
                                        : "Envío internacional por cotizar"}
                                </p>
                                <p className="text-[10px] text-warning">
                                    Entrega est. 15–30 días hábiles tras el despacho del proveedor
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </Link>

            {/* Footer add row — outside the Link, normal flow, always visible */}
            <div className="mt-2">
                <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => addItem(product)}
                    aria-label={soldOut ? `${product.name} agotado` : `Agregar ${product.name} al carrito`}
                    className="motion-press flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-black/30"
                >
                    <ShoppingCart className="h-4 w-4" aria-hidden />
                    {soldOut ? "Agotado" : "Agregar"}
                </button>
            </div>
        </div>
    );
}
