"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
    ShoppingCart,
    Minus,
    Plus,
    Check,
    Truck,
    Shield,
    ChevronRight,
} from "lucide-react";
import { Product } from "@/lib/types";
import { formatCOP } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import ProductCard from "@/components/products/ProductCard";
import FadeIn from "@/components/common/FadeIn";

interface ProductDetailClientProps {
    product: Product;
    related: Product[];
}

export default function ProductDetailClient({
    product,
    related,
}: ProductDetailClientProps) {
    const [selectedImage, setSelectedImage] = useState(0);
    const [quantity, setQuantity] = useState(1);
    const [added, setAdded] = useState(false);
    const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
    const addItem = useCartStore((s) => s.addItem);

    const externalImages = product.images.filter((src) => /^https?:\/\//.test(src));

    const discount = product.originalPrice
        ? Math.round(
            ((product.originalPrice - product.price) / product.originalPrice) * 100
        )
        : 0;

    const handleAdd = () => {
        for (let i = 0; i < quantity; i++) {
            addItem(product);
        }
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
    };

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Breadcrumb */}
                <FadeIn>
                    <nav className="flex items-center gap-2 text-sm text-muted mb-8">
                        <Link href="/" className="hover:text-white transition-colors">
                            Inicio
                        </Link>
                        <ChevronRight className="w-3 h-3" />
                        <Link
                            href="/products"
                            className="hover:text-white transition-colors"
                        >
                            Productos
                        </Link>
                        <ChevronRight className="w-3 h-3" />
                        <span className="text-white">{product.name}</span>
                    </nav>
                </FadeIn>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Gallery */}
                    <FadeIn>
                        <div>
                            {/* Main image */}
                            <div className="glass rounded-3xl overflow-hidden aspect-square mb-4 relative">
                                {externalImages[selectedImage] && !imageErrors[selectedImage] ? (
                                    <Image
                                        src={externalImages[selectedImage]}
                                        alt={product.name}
                                        fill
                                        unoptimized
                                        sizes="(max-width: 1024px) 100vw, 50vw"
                                        onError={() => setImageErrors((prev) => ({ ...prev, [selectedImage]: true }))}
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary/20 via-surface to-secondary/10 flex items-center justify-center product-glow">
                                        <span className="text-8xl">💡</span>
                                    </div>
                                )}
                                {product.badge && (
                                    <span
                                        className={`absolute top-4 left-4 px-4 py-1.5 rounded-full text-sm font-bold uppercase ${product.badge === "sale"
                                                ? "bg-accent text-black"
                                                : "bg-secondary text-black"
                                            }`}
                                    >
                                        {product.badge === "sale" ? `-${discount}%` : "Nuevo"}
                                    </span>
                                )}
                            </div>
                            {/* Thumbnails */}
                            <div className="flex gap-3">
                                {externalImages.map((src, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setSelectedImage(i)}
                                        className={`w-20 h-20 rounded-xl overflow-hidden glass transition-all ${selectedImage === i
                                                ? "border-primary glow-purple"
                                                : "border-transparent hover:border-primary/40"
                                            }`}
                                    >
                                        {imageErrors[i] ? (
                                            <div className="w-full h-full bg-gradient-to-br from-primary/10 via-surface to-secondary/5 flex items-center justify-center">
                                                <span className="text-2xl">💡</span>
                                            </div>
                                        ) : (
                                            <Image
                                                src={src}
                                                alt=""
                                                width={80}
                                                height={80}
                                                unoptimized
                                                onError={() => setImageErrors((prev) => ({ ...prev, [i]: true }))}
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </FadeIn>

                    {/* Details */}
                    <FadeIn delay={0.2}>
                        <div>
                            <div className="mb-2 text-sm text-secondary uppercase tracking-widest">
                                {product.category}
                            </div>
                            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-4">
                                {product.name}
                            </h1>

                            {/* Price */}
                            <div className="flex items-center gap-4 mb-6">
                                <span className="text-3xl font-bold text-white">
                                    {formatCOP(product.price)}
                                </span>
                                {product.originalPrice && (
                                    <>
                                        <span className="text-lg text-muted line-through">
                                            {formatCOP(product.originalPrice)}
                                        </span>
                                        <span className="px-2 py-1 rounded-full bg-accent/20 text-accent text-sm font-semibold">
                                            -{discount}%
                                        </span>
                                    </>
                                )}
                            </div>

                            <p className="text-muted leading-relaxed mb-8">
                                {product.description}
                            </p>

                            {/* Stock */}
                            <div className="flex items-center gap-2 mb-6">
                                <span
                                    className={`w-2 h-2 rounded-full ${product.stock > 10
                                            ? "bg-green-500"
                                            : product.stock > 0
                                                ? "bg-amber-500"
                                                : "bg-red-500"
                                        }`}
                                />
                                <span className="text-sm text-muted">
                                    {product.stock > 10
                                        ? "En stock"
                                        : product.stock > 0
                                            ? `Solo ${product.stock} disponibles`
                                            : "Agotado"}
                                </span>
                            </div>

                            {/* Quantity */}
                            <div className="flex items-center gap-4 mb-8">
                                <span className="text-sm text-muted">Cantidad:</span>
                                <div className="flex items-center glass rounded-xl">
                                    <button
                                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                        className="px-3 py-2 text-muted hover:text-white transition-colors"
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <span className="px-4 py-2 text-white font-semibold min-w-[40px] text-center">
                                        {quantity}
                                    </span>
                                    <button
                                        onClick={() =>
                                            setQuantity(Math.min(product.stock, quantity + 1))
                                        }
                                        className="px-3 py-2 text-muted hover:text-white transition-colors"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Add to cart */}
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleAdd}
                                disabled={product.stock === 0}
                                className={`w-full py-4 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 transition-all duration-300 ${added
                                        ? "bg-green-600 text-white"
                                        : "bg-primary hover:bg-primary-light text-white glow-purple"
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {added ? (
                                    <>
                                        <Check className="w-5 h-5" /> ¡Agregado al carrito!
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart className="w-5 h-5" /> Agregar al Carrito
                                    </>
                                )}
                            </motion.button>

                            {/* Benefits */}
                            <div className="mt-8 grid grid-cols-2 gap-4">
                                <div className="flex items-center gap-3 text-sm text-muted">
                                    <Truck className="w-4 h-4 text-secondary" />
                                    <span>Envío en 2-5 días</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted">
                                    <Shield className="w-4 h-4 text-primary" />
                                    <span>Garantía 6 meses</span>
                                </div>
                            </div>
                        </div>
                    </FadeIn>
                </div>

                {/* How it looks section */}
                <FadeIn>
                    <div className="mt-24">
                        <h2 className="font-heading text-3xl font-bold text-white mb-8">
                            Cómo se ve en tu <span className="gradient-text">habitación</span>
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="glass rounded-3xl aspect-video overflow-hidden bg-gradient-to-br from-primary/10 via-surface to-secondary/5 flex items-center justify-center">
                                <span className="text-6xl">🛋️💡</span>
                            </div>
                            <div className="glass rounded-3xl aspect-video overflow-hidden bg-gradient-to-br from-secondary/10 via-surface to-primary/5 flex items-center justify-center">
                                <span className="text-6xl">🌙💡</span>
                            </div>
                        </div>
                    </div>
                </FadeIn>

                {/* Related */}
                {related.length > 0 && (
                    <FadeIn>
                        <div className="mt-24">
                            <h2 className="font-heading text-3xl font-bold text-white mb-8">
                                También te puede{" "}
                                <span className="gradient-text">interesar</span>
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {related.map((p, i) => (
                                    <ProductCard key={p.id} product={p} index={i} />
                                ))}
                            </div>
                        </div>
                    </FadeIn>
                )}
            </div>
        </div>
    );
}
