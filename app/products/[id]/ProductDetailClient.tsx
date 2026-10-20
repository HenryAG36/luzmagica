"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ShoppingCart,
    Minus,
    Plus,
    Truck,
    ShieldCheck,
    CreditCard,
    Star,
    ChevronRight,
} from "lucide-react";
import { Product } from "@/lib/types";
import { formatCOP } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import ProductCard from "@/components/products/ProductCard";
import ProductImage from "@/components/common/ProductImage";
import PriceTag from "@/components/common/PriceTag";
import ProductReviews from "@/components/products/ProductReviews";
import FadeIn from "@/components/common/FadeIn";

interface ProductDetailClientProps {
    product: Product;
    related: Product[];
}

function validDiscount(product: Product): number {
    const original = product.originalPrice;
    if (typeof original !== "number" || !Number.isFinite(original)) return 0;
    if (original <= product.price || product.price <= 0) return 0;
    return Math.round(((original - product.price) / original) * 100);
}

export default function ProductDetailClient({
    product,
    related,
}: ProductDetailClientProps) {
    const [selectedImage, setSelectedImage] = useState(0);
    const [quantity, setQuantity] = useState(1);
    const addItem = useCartStore((s) => s.addItem);

    const discount = validDiscount(product);
    const savings = discount > 0 ? product.originalPrice! - product.price : 0;
    const soldOut = !Number.isFinite(product.stock) || product.stock <= 0;
    const maxQty = Math.min(Math.max(0, product.stock), 20);
    const hasRating =
        typeof product.reviewsCount === "number" &&
        product.reviewsCount > 0 &&
        typeof product.reviewsAvg === "number" &&
        Number.isFinite(product.reviewsAvg);

    const handleAdd = () => {
        addItem(product, quantity);
    };

    return (
        <div className="px-4 pb-28 pt-8 lg:pb-16">
            <div className="mx-auto max-w-7xl">
                {/* Breadcrumb */}
                <nav aria-label="Ruta de navegación" className="mb-8 flex items-center gap-2 text-sm text-muted">
                    <Link href="/" className="transition-colors hover:text-foreground">Inicio</Link>
                    <ChevronRight className="h-3 w-3" aria-hidden />
                    <Link href="/products" className="transition-colors hover:text-foreground">Catálogo</Link>
                    <ChevronRight className="h-3 w-3" aria-hidden />
                    <span className="truncate text-foreground" aria-current="page">{product.name}</span>
                </nav>

                <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
                    {/* Gallery */}
                    <FadeIn>
                        <div>
                            <div className="relative mb-4 aspect-square overflow-hidden rounded-3xl border border-black/10 bg-surface-light">
                                <div
                                    key={`${product.id}-${selectedImage}`}
                                    className="motion-image absolute inset-0"
                                >
                                    <ProductImage
                                        src={product.images[selectedImage]}
                                        alt={product.name}
                                        sizes="(max-width: 1024px) 100vw, 50vw"
                                        priority
                                    />
                                </div>
                                {discount > 0 && (
                                    <span className="absolute left-4 top-4 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-white">
                                        -{discount}%
                                    </span>
                                )}
                                {soldOut && (
                                    <span className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">
                                        Agotado
                                    </span>
                                )}
                            </div>
                            {product.images.length > 1 && (
                                <div className="flex gap-3 overflow-x-auto pb-1" aria-label="Imágenes del producto">
                                    {product.images.map((src, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => setSelectedImage(i)}
                                            aria-label={`Ver imagen ${i + 1}`}
                                            aria-pressed={selectedImage === i}
                                            className={`motion-press relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-surface-light transition-colors ${
                                                selectedImage === i
                                                    ? "border-foreground"
                                                    : "border-black/10 hover:border-black/30"
                                            }`}
                                        >
                                            <ProductImage src={src} alt="" sizes="80px" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </FadeIn>

                    {/* Details */}
                    <FadeIn delay={0.15}>
                        <div>
                            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-accent-dark">
                                {product.category.replace(/-/g, " ")}
                            </p>
                            <h1 className="mb-4 font-heading text-3xl font-semibold sm:text-4xl">
                                {product.name}
                            </h1>

                            {hasRating && (
                                <p className="mb-4 flex items-center gap-1.5 text-sm text-muted">
                                    <span className="flex" aria-hidden>
                                        {[1, 2, 3, 4, 5].map((s) => (
                                            <Star
                                                key={s}
                                                className={`h-4 w-4 ${s <= Math.round(product.reviewsAvg!) ? "fill-accent text-accent" : "text-black/20"}`}
                                            />
                                        ))}
                                    </span>
                                    <span className="font-semibold text-foreground">
                                        {product.reviewsAvg!.toFixed(1)}
                                    </span>
                                    <span>
                                        · {product.reviewsCount}{" "}
                                        {product.reviewsCount === 1 ? "reseña verificada" : "reseñas verificadas"}
                                    </span>
                                </p>
                            )}

                            {/* Price */}
                            <div className="mb-6">
                                <PriceTag price={product.price} originalPrice={product.originalPrice} />
                            </div>

                            {/* Shipping quote box */}
                            {product.shippingQuoteRequired && (
                                <div className="mb-6 space-y-1.5 rounded-2xl border border-black/10 bg-surface p-4 text-xs">
                                    <div className="flex justify-between text-muted">
                                        <span>Producto</span>
                                        <span className="text-foreground">{formatCOP(product.price)}</span>
                                    </div>
                                    <div className="flex justify-between text-muted">
                                        <span>
                                            Envío estimado por unidad
                                            {product.shippingEstimateCity ? ` a ${product.shippingEstimateCity}` : ""}
                                        </span>
                                        {product.shippingEstimateCOP == null ? (
                                            <span className="font-medium text-warning">Pendiente de cotización</span>
                                        ) : (
                                            <span className="text-foreground">{formatCOP(product.shippingEstimateCOP)}</span>
                                        )}
                                    </div>
                                    {product.shippingEstimateCOP != null && (
                                        <div className="flex justify-between border-t border-black/10 pt-1.5 font-semibold">
                                            <span>Total estimado</span>
                                            <span>{formatCOP(product.price + product.shippingEstimateCOP)}</span>
                                        </div>
                                    )}
                                    <p className="text-[11px] font-medium text-warning">
                                        Envío cotizado por unidad: el tiempo de entrega depende del
                                        destino y la transportadora.
                                    </p>
                                    <p className="text-[10px] text-muted">
                                        La cotización es indicativa por unidad
                                        {product.shippingEstimateCity ? ` a ${product.shippingEstimateCity}` : ""}
                                        {product.shippingCheckedAt
                                            ? `, consultada el ${new Date(product.shippingCheckedAt).toLocaleDateString("es-CO")}`
                                            : ""}
                                        ; puede variar para tu ciudad.
                                    </p>
                                </div>
                            )}

                            <p className="mb-8 leading-relaxed text-muted">{product.description}</p>

                            {/* Stock */}
                            <p className="mb-6 flex items-center gap-2 text-sm">
                                <span
                                    className={`h-2 w-2 rounded-full ${
                                        product.stock > 10 ? "bg-success" : product.stock > 0 ? "bg-warning" : "bg-danger"
                                    }`}
                                    aria-hidden
                                />
                                <span className="text-muted">
                                    {product.stock > 10
                                        ? "Disponible"
                                        : product.stock > 0
                                          ? `${product.stock} disponibles`
                                          : "Agotado"}
                                </span>
                            </p>

                            {/* Quantity */}
                            {!soldOut && (
                                <div className="mb-8 flex items-center gap-4">
                                    <span className="text-sm text-muted">Cantidad:</span>
                                    <div className="flex items-center rounded-xl border border-black/10">
                                        <button
                                            type="button"
                                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                            aria-label="Disminuir cantidad"
                                            className="motion-press px-3 py-2 text-muted transition-colors hover:text-foreground"
                                        >
                                            <Minus className="h-4 w-4" />
                                        </button>
                                        <span className="min-w-10 px-4 py-2 text-center font-semibold" aria-live="polite">
                                            {quantity}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setQuantity(Math.min(maxQty, quantity + 1))}
                                            aria-label="Aumentar cantidad"
                                            className="motion-press px-3 py-2 text-muted transition-colors hover:text-foreground"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Add to cart (desktop) */}
                            <button
                                type="button"
                                onClick={handleAdd}
                                disabled={soldOut}
                                className="motion-press hidden w-full items-center justify-center gap-3 rounded-full bg-foreground py-4 text-base font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-black/30 lg:flex"
                            >
                                <ShoppingCart className="h-5 w-5" />
                                {soldOut ? "Agotado" : "Agregar al carrito"}
                            </button>

                            {/* Trust chips */}
                            <div className="mt-8 grid grid-cols-1 gap-3 text-xs text-muted sm:grid-cols-3">
                                <span className="flex items-center gap-2">
                                    <CreditCard className="h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                                    Medios disponibles según Wompi al pagar
                                </span>
                                <span className="flex items-center gap-2">
                                    <Truck className="h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                                    {product.shippingQuoteRequired
                                        ? "Envío cotizado por unidad"
                                        : "El costo de envío se confirma antes del pago"}
                                </span>
                                <span className="flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                                    <Link href="/legal/devoluciones" className="hover:underline underline-offset-2">
                                        Consulta retracto y devoluciones
                                    </Link>
                                </span>
                            </div>
                        </div>
                    </FadeIn>
                </div>

                {/* Verified purchase reviews */}
                <FadeIn>
                    <div className="mt-16">
                        <ProductReviews productId={product.id} />
                    </div>
                </FadeIn>

                {/* Related */}
                {related.length > 0 && (
                    <FadeIn>
                        <div className="mt-20">
                            <h2 className="mb-8 font-heading text-3xl font-semibold">
                                También te puede interesar
                            </h2>
                            <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
                                {related.map((p) => (
                                    <ProductCard key={p.id} product={p} />
                                ))}
                            </div>
                        </div>
                    </FadeIn>
                )}
            </div>

            {/* Sticky mobile buy bar */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
                <div className="mx-auto flex max-w-7xl items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-muted">{product.name}</p>
                        <p className="text-base font-bold text-foreground">
                            {formatCOP(product.price)}
                            {savings > 0 && (
                                <span className="ml-1.5 text-xs font-medium text-accent-dark">
                                    -{discount}%
                                </span>
                            )}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={soldOut}
                        className="motion-press flex shrink-0 items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-black/30"
                    >
                        <ShoppingCart className="h-4 w-4" />
                        {soldOut ? "Agotado" : "Agregar"}
                    </button>
                </div>
            </div>
        </div>
    );
}
