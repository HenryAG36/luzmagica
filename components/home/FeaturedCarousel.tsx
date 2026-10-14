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

    if (products.length === 0) {
        return (
            <section className="px-4 py-16">
                <div className="mx-auto max-w-7xl">
                    <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-10 text-center">
                        <h2 className="font-heading text-2xl font-semibold">Catálogo en preparación</h2>
                        <p className="mt-2 text-sm text-muted">
                            Estamos publicando nuevos productos. Vuelve pronto para ver la colección.
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    const scroll = (direction: "left" | "right") => {
        if (scrollRef.current) {
            const amount = direction === "left" ? -320 : 320;
            scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
        }
    };

    return (
        <section className="px-4 py-16 sm:py-20">
            <div className="mx-auto max-w-7xl">
                <FadeIn>
                    <div className="mb-10 flex items-end justify-between">
                        <div>
                            <span className="text-xs font-medium uppercase tracking-[0.2em] text-accent-dark">
                                Catálogo
                            </span>
                            <h2 className="mt-3 font-heading text-4xl font-semibold sm:text-5xl">
                                Productos destacados
                            </h2>
                        </div>
                        <div className="hidden gap-2 sm:flex">
                            <button
                                type="button"
                                onClick={() => scroll("left")}
                                aria-label="Desplazar a la izquierda"
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-muted transition-colors hover:bg-black/5 hover:text-foreground"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => scroll("right")}
                                aria-label="Desplazar a la derecha"
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-muted transition-colors hover:bg-black/5 hover:text-foreground"
                            >
                                <ChevronRight className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </FadeIn>

                <div
                    ref={scrollRef}
                    className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                    {products.map((product) => (
                        <div key={product.id} className="w-[240px] min-w-[240px] snap-start sm:w-[280px] sm:min-w-[280px]">
                            <ProductCard product={product} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
