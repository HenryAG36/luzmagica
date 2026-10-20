"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, ChevronLeft, ChevronRight, PackagePlus, RefreshCw, Search } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { isHttpUrl } from "@/lib/catalog/validate";
import type { ImportSource, SupplierProduct } from "@/lib/catalog/supplierImport";

interface Props {
    onSelect: (selection: { source: ImportSource; productId: string }) => void;
}

interface PageResult {
    products: SupplierProduct[];
    offset: number;
    hasMore: boolean;
    warnings: string[];
}

// Mastershop is the only importable supplier under the current sourcing
// policy.
const PROVIDER = {
    label: "Mastershop",
    source: "mastershop" as ImportSource,
    title: "Catálogo Mastershop",
    description:
        "Busca productos del marketplace de Mastershop y consulta su precio y stock antes de importarlos como borrador. El envío se confirma manualmente según la ciudad del cliente y el producto debe agregarse a «Mis productos» en Mastershop antes de vender.",
    apiPath: "/api/admin/suppliers/mastershop/products",
};

const PAGE = 20;

const inputClass =
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-black/10 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary";

export default function LocalSupplierCatalogPanel({ onSelect }: Props) {
    const cfg = PROVIDER;
    const [query, setQuery] = useState("");
    const [submitted, setSubmitted] = useState("");
    const [page, setPage] = useState<PageResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [attempted, setAttempted] = useState(false);

    const seq = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const load = useCallback(async (q: string, off: number) => {
        const mySeq = ++seq.current;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError("");
        try {
            const res = await fetch(
                `${cfg.apiPath}?query=${encodeURIComponent(q)}&offset=${off}`,
                { signal: controller.signal }
            );
            const body = await res.json().catch(() => ({}));
            if (mySeq !== seq.current) return; // obsolete response
            if (!res.ok) {
                setPage(null);
                setError(body.error || `No se pudo consultar el catálogo de ${cfg.label} (HTTP ${res.status}).`);
                return;
            }
            setPage(body as PageResult);
        } catch (e) {
            if ((e as Error).name === "AbortError") return;
            if (mySeq === seq.current) {
                setPage(null);
                setError(`Error de red al consultar ${cfg.label}.`);
            }
        } finally {
            if (mySeq === seq.current) setLoading(false);
        }
    }, [cfg]);

    // Abort only on unmount — no state updates.
    useEffect(
        () => () => {
            seq.current += 1;
            abortRef.current?.abort();
        },
        []
    );

    const handleSearch = () => {
        const q = query.trim();
        setAttempted(true);
        setSubmitted(q);
        void load(q, 0);
    };

    const goTo = (nextOffset: number) => {
        void load(submitted, nextOffset);
    };

    return (
        <div className="glass rounded-3xl p-6 md:p-8 space-y-4">
            <h4 className="font-heading text-base font-bold text-foreground">
                {cfg.title}
            </h4>
            <p className="text-[11px] text-muted">
                {cfg.description}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Buscar en el catálogo ${cfg.label}...`}
                        className={`${inputClass} pl-9`}
                        maxLength={120}
                        aria-label={`Buscar en ${cfg.label}`}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSearch();
                        }}
                    />
                </div>
                <button
                    type="button"
                    onClick={handleSearch}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-all disabled:opacity-50 shrink-0 flex items-center gap-2"
                >
                    {loading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <Search className="w-3.5 h-3.5" />
                    )}
                    {loading ? "Buscando..." : "Buscar"}
                </button>
            </div>

            {error && (
                <div role="alert" className="p-3.5 rounded-2xl bg-red-500/15 border border-danger/30 text-danger text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {page && page.warnings.length > 0 && (
                <ul className="space-y-1">
                    {page.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] text-warning">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{w}</span>
                        </li>
                    ))}
                </ul>
            )}

            {page && (
                <>
                    {page.products.length === 0 ? (
                        <p className="py-6 text-center text-muted text-sm">
                            Sin resultados{submitted ? ` para "${submitted}"` : ` en el catálogo ${cfg.label}`}.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {page.products.map((p) => {
                                const price =
                                    p.variants.length === 1 ? (p.variants[0]?.price ?? null) : null;
                                return (
                                    <article
                                        key={p.productId}
                                        className="rounded-2xl p-4 bg-surface-card border border-black/10 flex flex-col gap-2"
                                    >
                                        <div className="flex gap-3">
                                            {p.images[0] && isHttpUrl(p.images[0]) && (
                                                <Image
                                                    src={p.images[0]}
                                                    alt=""
                                                    width={56}
                                                    height={56}
                                                    unoptimized
                                                    className="rounded-xl object-cover w-14 h-14 shrink-0"
                                                />
                                            )}
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-foreground line-clamp-2">
                                                    {p.title}
                                                </p>
                                                <p className="text-[10px] text-muted mt-0.5">
                                                    {cfg.label} · ID {p.productId}
                                                    {p.category ? ` · ${p.category}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-muted">
                                            {p.variants.length > 1
                                                ? "Precio según variante"
                                                : price !== null
                                                  ? `Precio proveedor ${formatCOP(price)}`
                                                  : "Precio proveedor no reportado"}
                                        </p>
                                        <button
                                            type="button"
                                            disabled={loading}
                                            onClick={() => onSelect({ source: cfg.source, productId: p.productId })}
                                            className="mt-auto w-full px-3 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                                        >
                                            <PackagePlus className="w-3.5 h-3.5" />
                                            Consultar e importar
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                    {/* Pagination stays visible even when every raw result was
                        skipped as invalid — otherwise a bad page traps the
                        operator. Offsets come from the rendered page, never
                        from the in-flight request. */}
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            disabled={loading || page.offset === 0}
                            onClick={() => goTo(Math.max(0, page.offset - PAGE))}
                            className="px-3 py-2 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs hover:bg-black/10 disabled:opacity-40 flex items-center gap-1"
                        >
                            <ChevronLeft className="w-3 h-3" /> Anterior
                        </button>
                        <span className="text-[10px] text-muted">
                            {page.products.length} productos desde {page.offset}
                        </span>
                        <button
                            type="button"
                            disabled={loading || !page.hasMore || page.offset + PAGE > 100000}
                            onClick={() => goTo(page.offset + PAGE)}
                            className="px-3 py-2 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs hover:bg-black/10 disabled:opacity-40 flex items-center gap-1"
                        >
                            Siguiente <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                </>
            )}
            {!page && !error && attempted && loading && (
                <p className="py-6 text-center text-muted text-sm animate-pulse">
                    Consultando el catálogo {cfg.label}...
                </p>
            )}
        </div>
    );
}
