import Link from "next/link";
import type { Product } from "@/lib/types";
import FadeIn from "@/components/common/FadeIn";

const CATEGORY_EMOJI: Record<string, string> = {
    lamparas: "💡",
    "tiras-led": "✨",
    paneles: "⬡",
    accesorios: "🔌",
    decoracion: "🏠",
};

function tileEmoji(category: string): string {
    return CATEGORY_EMOJI[category] ?? "▪";
}

export default function CategoryGrid({ products }: { products: Product[] }) {
    const counts = new Map<string, number>();
    for (const product of products) {
        if (!product.category) continue;
        counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    }
    const categories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4);

    if (categories.length === 0) return null;

    return (
        <section id="categorias" className="px-4 py-16 sm:py-20">
            <div className="mx-auto max-w-7xl">
                <FadeIn>
                    <div className="mb-10 text-center">
                        <span className="text-xs font-medium uppercase tracking-[0.2em] text-accent-dark">
                            Colecciones
                        </span>
                        <h2 className="mt-3 font-heading text-4xl font-semibold sm:text-5xl">
                            Explora por categoría
                        </h2>
                    </div>
                </FadeIn>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {categories.map(([category, count], i) => (
                        <FadeIn key={category} delay={i * 0.08}>
                            <Link
                                href={`/products?category=${encodeURIComponent(category)}`}
                                className="group flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-black/10 bg-surface transition-all hover:border-accent/50 hover:shadow-md"
                            >
                                <span className="text-4xl transition-transform group-hover:scale-110" aria-hidden>
                                    {tileEmoji(category)}
                                </span>
                                <span className="font-heading text-xl font-semibold capitalize">
                                    {category.replace(/-/g, " ")}
                                </span>
                                <span className="text-xs text-muted">
                                    {count} {count === 1 ? "producto" : "productos"}
                                </span>
                            </Link>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    );
}
