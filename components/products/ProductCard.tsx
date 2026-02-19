"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ShoppingCart } from "lucide-react";
import { Product } from "@/lib/types";
import { formatCOP } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";

interface ProductCardProps {
    product: Product;
    index?: number;
}

export default function ProductCard({ product, index = 0 }: ProductCardProps) {
    const addItem = useCartStore((s) => s.addItem);

    const discount = product.originalPrice
        ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
        : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className="group relative"
        >
            <Link href={`/products/${product.id}`}>
                <div className="glass rounded-2xl overflow-hidden transition-all duration-500 group-hover:glow-purple group-hover:border-primary/40">
                    {/* Image */}
                    <div className="relative aspect-square overflow-hidden bg-surface">
                        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent z-10" />
                        {/* Placeholder gradient for product image */}
                        <div className="w-full h-full bg-gradient-to-br from-primary/20 via-surface to-secondary/10 flex items-center justify-center transition-transform duration-700 group-hover:scale-110">
                            <span className="text-4xl opacity-60">💡</span>
                        </div>

                        {/* Badge */}
                        {product.badge && (
                            <span
                                className={`absolute top-3 left-3 z-20 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${product.badge === "sale"
                                        ? "bg-accent text-black"
                                        : "bg-secondary text-black"
                                    }`}
                            >
                                {product.badge === "sale" ? `-${discount}%` : "Nuevo"}
                            </span>
                        )}
                    </div>

                    {/* Info */}
                    <div className="p-4">
                        <h3 className="font-heading font-semibold text-sm text-white mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                            {product.name}
                        </h3>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-white">{formatCOP(product.price)}</span>
                            {product.originalPrice && (
                                <span className="text-sm text-muted line-through">
                                    {formatCOP(product.originalPrice)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </Link>

            {/* Quick Add */}
            <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                    e.preventDefault();
                    addItem(product);
                }}
                className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-primary hover:bg-primary-light text-white flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 z-20"
            >
                <ShoppingCart className="w-4 h-4" />
            </motion.button>
        </motion.div>
    );
}
