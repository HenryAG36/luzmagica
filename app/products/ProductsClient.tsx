"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X, Search } from "lucide-react";
import ProductCard from "@/components/products/ProductCard";
import FadeIn from "@/components/common/FadeIn";
import { Product } from "@/lib/types";

const priceRanges = [
    { value: "", label: "Todos los precios", min: 0, max: Infinity },
    { value: "0-50000", label: "Hasta $50.000", min: 0, max: 50000 },
    { value: "50000-100000", label: "$50.000 – $100.000", min: 50000, max: 100000 },
    { value: "100000-200000", label: "$100.000 – $200.000", min: 100000, max: 200000 },
    { value: "200000-inf", label: "Más de $200.000", min: 200000, max: Infinity },
];

const sortOptions = [
    { value: "relevancia", label: "Relevancia" },
    { value: "precio-asc", label: "Precio: menor a mayor" },
    { value: "precio-desc", label: "Precio: mayor a menor" },
    { value: "descuento", label: "Mayor descuento" },
];

function normalizeText(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function label(value: string): string {
    return value.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function discountOf(p: Product): number {
    const original = p.originalPrice;
    if (typeof original !== "number" || !Number.isFinite(original)) return 0;
    if (original <= p.price || p.price <= 0) return 0;
    return (original - p.price) / original;
}

interface ProductsClientProps {
    products: Product[];
}

export default function ProductsClient({ products }: ProductsClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const q = searchParams.get("q") ?? "";
    const category = searchParams.get("category") ?? "";
    const type = searchParams.get("type") ?? "";
    const price = searchParams.get("price") ?? "";
    const sort = searchParams.get("sort") ?? "relevancia";
    const room = searchParams.get("room") ?? ""; // legacy links
    const filtersOpen = searchParams.get("filtros") === "1";

    const setParam = (key: string, value: string, push = false) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value);
        else params.delete(key);
        const url = `/products?${params.toString()}`;
        if (push) router.push(url, { scroll: false });
        else router.replace(url, { scroll: false });
    };

    const categories = useMemo(
        () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
        [products],
    );
    const types = useMemo(
        () => [...new Set(products.map((p) => p.type).filter(Boolean))].sort(),
        [products],
    );

    const filtered = useMemo(() => {
        const bucket = priceRanges.find((r) => r.value === price);
        const needle = normalizeText(q.trim());
        const list = products.filter((p) => {
            if (room && p.room !== room) return false;
            if (category && p.category !== category) return false;
            if (type && p.type !== type) return false;
            if (bucket && bucket.value) {
                if (p.price < bucket.min || p.price >= bucket.max) return false;
            }
            if (needle) {
                const hay = normalizeText(`${p.name} ${p.description ?? ""}`);
                if (!hay.includes(needle)) return false;
            }
            return true;
        });
        switch (sort) {
            case "precio-asc":
                return [...list].sort((a, b) => a.price - b.price);
            case "precio-desc":
                return [...list].sort((a, b) => b.price - a.price);
            case "descuento":
                return [...list].sort((a, b) => discountOf(b) - discountOf(a));
            default:
                return [...list].sort((a, b) => a.name.localeCompare(b.name));
        }
    }, [products, q, category, type, price, sort, room]);

    const hasFilters = q || category || type || price || room;

    const filterGroup = (
        title: string,
        options: { value: string; label: string }[],
        current: string,
        paramKey: string,
    ) => (
        <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted">{title}</legend>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={current === option.value}
                        onClick={() => setParam(paramKey, option.value)}
                        className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                            current === option.value
                                ? "bg-foreground text-white"
                                : "border border-black/10 text-muted hover:border-black/25 hover:text-foreground"
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );

    return (
        <div className="px-4 pb-16 pt-10">
            <div className="mx-auto max-w-7xl">
                <FadeIn>
                    <div className="mb-10">
                        <h1 className="font-heading text-4xl font-semibold sm:text-5xl">
                            Catálogo
                        </h1>
                        <p className="mt-3 max-w-xl text-muted">
                            Precios claros, envío cotizado antes de pagar.
                        </p>
                    </div>
                </FadeIn>

                {/* Search + sort bar */}
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <form
                        role="search"
                        className="relative flex-1"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            setParam("q", String(data.get("q") ?? "").trim(), true);
                        }}
                    >
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                        <label className="sr-only" htmlFor="catalog-search">Buscar en el catálogo</label>
                        <input
                            id="catalog-search"
                            name="q"
                            type="search"
                            defaultValue={q}
                            key={q}
                            placeholder="Buscar en el catálogo…"
                            className="w-full rounded-full border border-black/10 bg-surface py-2.5 pl-9 pr-20 text-sm focus:outline-none focus:border-accent/60"
                        />
                        <button
                            type="submit"
                            aria-label="Buscar en el catálogo"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light"
                        >
                            Buscar
                        </button>
                    </form>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setParam("filtros", filtersOpen ? "" : "1")}
                            aria-expanded={filtersOpen}
                            className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground md:hidden"
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                            Filtros
                            {hasFilters && <span className="h-2 w-2 rounded-full bg-accent" />}
                        </button>
                        <label htmlFor="sort-select" className="sr-only">Ordenar por</label>
                        <select
                            id="sort-select"
                            value={sort}
                            onChange={(e) => setParam("sort", e.target.value === "relevancia" ? "" : e.target.value)}
                            className="rounded-full border border-black/10 bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-accent/60"
                        >
                            {sortOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex flex-col gap-8 md:flex-row">
                    {/* Filters sidebar */}
                    <aside className={`${filtersOpen ? "block" : "hidden"} w-64 shrink-0 md:block`}>
                        <div className={`${filtersOpen ? "motion-reveal " : ""}sticky top-32 space-y-6 rounded-2xl border border-black/10 bg-surface p-6`}>
                            <div className="flex items-center justify-between">
                                <h2 className="font-heading text-lg font-semibold">Filtros</h2>
                                {hasFilters && (
                                    <button
                                        type="button"
                                        onClick={() => router.replace("/products", { scroll: false })}
                                        className="flex items-center gap-1 text-xs text-accent-dark hover:underline"
                                    >
                                        <X className="h-3 w-3" />
                                        Limpiar
                                    </button>
                                )}
                            </div>

                            {filterGroup(
                                "Categoría",
                                [
                                    { value: "", label: "Todas" },
                                    ...categories.map((c) => ({ value: c, label: label(c) })),
                                ],
                                category,
                                "category",
                            )}
                            {filterGroup(
                                "Tipo",
                                [
                                    { value: "", label: "Todos" },
                                    ...types.map((t) => ({ value: t, label: label(t) })),
                                ],
                                type,
                                "type",
                            )}
                            {filterGroup("Precio", priceRanges.map(({ value, label: l }) => ({ value, label: l })), price, "price")}
                        </div>
                    </aside>

                    {/* Product grid */}
                    <div className="flex-1">
                        <p className="mb-5 text-sm text-muted" aria-live="polite">
                            {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
                            {q.trim() ? ` para “${q.trim()}”` : ""}
                        </p>

                        {filtered.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-black/15 bg-surface py-20 text-center">
                                {products.length === 0 ? (
                                    <>
                                        <p className="font-heading text-2xl font-semibold">Catálogo en preparación</p>
                                        <p className="mt-2 text-sm text-muted">
                                            Aún no hay productos publicados. Vuelve pronto.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="font-heading text-2xl font-semibold">Sin resultados</p>
                                        <p className="mt-2 text-sm text-muted">
                                            No se encontraron productos con estos filtros.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => router.replace("/products", { scroll: false })}
                                            className="mt-4 text-sm font-medium text-accent-dark hover:underline"
                                        >
                                            Limpiar filtros
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
                                {filtered.map((product) => (
                                    <ProductCard key={product.id} product={product} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
