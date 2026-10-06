"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ProductCard from "@/components/products/ProductCard";
import FadeIn from "@/components/common/FadeIn";
import { Product } from "@/lib/types";

interface FeaturedCarouselProps {
    products: Product[];
}

export default function FeaturedCarousel({ products }: FeaturedCarouselProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const scroll = (direction: "left" | "right") => {
        if (scrollRef.current) {
            const amount = direction === "left" ? -320 : 320;
            scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
        }
    };

    return (
        <section className="py-24 px-4">
            <div className="max-w-7xl mx-auto">
                <FadeIn>
                    <div className="flex items-end justify-between mb-12">
                        <div>
                            <span className="text-secondary text-sm font-medium uppercase tracking-widest">
                                Catálogo
                            </span>
                            <h2 className="font-heading text-4xl sm:text-5xl font-bold mt-3">
                                Productos <span className="gradient-text">Destacados</span>
                            </h2>
                        </div>
                        <div className="hidden sm:flex gap-2">
                            <button
                                onClick={() => scroll("left")}
                                className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted hover:text-white hover:border-primary/40 transition-all"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => scroll("right")}
                                className="w-10 h-10 rounded-full glass flex items-center justify-center text-muted hover:text-white hover:border-primary/40 transition-all"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </FadeIn>

                <div
                    ref={scrollRef}
                    className="flex gap-6 overflow-x-auto scrollbar-hide pb-4 -mx-4 px-4 snap-x snap-mandatory"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                    {products.map((product, i) => (
                        <div
                            key={product.id}
                            className="min-w-[280px] max-w-[280px] snap-start"
                        >
                            <ProductCard product={product} index={i} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
