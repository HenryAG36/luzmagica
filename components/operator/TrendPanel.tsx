"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
    AlertCircle,
    Bookmark,
    CheckCircle2,
    Link2,
    PackagePlus,
    RefreshCw,
    Search,
    TrendingUp,
} from "lucide-react";
import { isHttpUrl } from "@/lib/catalog/validate";
import { describeEmptyFeed } from "@/lib/trends/emptyFeed";
import type { ImportSource } from "@/lib/catalog/supplierImport";
import type { TrendItem, TrendsPayload } from "@/lib/trends/types";
import SupplierImportPanel from "@/components/operator/SupplierImportPanel";
import SupplierConnectionsPanel from "@/components/operator/SupplierConnectionsPanel";
import ProductsPanel from "@/components/operator/ProductsPanel";

type View = "discover" | "import" | "drafts" | "connections";

const VIEWS: { id: View; label: string }[] = [
    { id: "discover", label: "Descubrir" },
    { id: "import", label: "Importar" },
    { id: "drafts", label: "Borradores" },
    { id: "connections", label: "Conexiones" },
];

const SIGNAL_LABELS: Record<string, string> = {
    search_keyword: "Búsqueda",
    best_seller_rank: "Más vendido",
    hot_product: "Producto caliente",
    supplier_feed: "Feed proveedor",
    supplier_trending: "Tendencia proveedor",
};

const SOURCE_LABELS: Record<string, string> = {
    mercadolibre: "MercadoLibre",
    aliexpress: "AliExpress Afiliados",
    aliexpress_ds: "AliExpress DS",
    cjdropshipping: "CJ Dropshipping",
};

const SUPPLIER_SOURCES = new Set(["aliexpress", "aliexpress_ds", "cjdropshipping"]);

function isView(v: string | null): v is View {
    return v === "discover" || v === "import" || v === "drafts" || v === "connections";
}

export default function TrendPanel({ onOpenCatalog }: { onOpenCatalog?: () => void }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const sectionParam = searchParams.get("section");
    const dsConnectResult = searchParams.get("ae_ds");
    // View is derived from the URL so back/forward and deep links work.
    const view: View = isView(sectionParam)
        ? sectionParam
        : dsConnectResult
          ? "connections"
          : "discover";

    const setView = useCallback(
        (next: View) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("tab", "trends");
            params.set("section", next);
            params.delete("ae_ds"); // explicit navigation clears OAuth result
            router.push(`${pathname}?${params.toString()}`, { scroll: false });
        },
        [router, pathname, searchParams]
    );
    const [data, setData] = useState<TrendsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");
    const [importingId, setImportingId] = useState<string | null>(null);
    const [selection, setSelection] = useState<{ source: ImportSource; productId: string } | null>(null);

    const load = useCallback(async () => {
        setError("");
        try {
            const res = await fetch("/api/admin/trends");
            if (res.ok) {
                setData(await res.json());
            } else {
                setError(`No se pudieron cargar las tendencias (HTTP ${res.status}).`);
            }
        } catch {
            setError("Error de red al cargar tendencias.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setNotice("");
        setError("");
        try {
            const res = await fetch("/api/admin/trends/refresh", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            });
            if (res.ok) {
                setData(await res.json());
            } else {
                setError(`No se pudo actualizar (HTTP ${res.status}).`);
            }
        } catch {
            setError("Error de red al actualizar.");
        } finally {
            setRefreshing(false);
        }
    };

    // MercadoLibre items are demand references, not supplier products.
    const handleSaveReference = async (item: TrendItem) => {
        setImportingId(item.id);
        setNotice("");
        setError("");
        try {
            const res = await fetch("/api/admin/catalog", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    source: item.source,
                    providerItemId: item.sourceId,
                    sourceUrl: item.url,
                    title: item.title,
                    images: item.image ? [item.image] : [],
                    listingPrice: item.price,
                    listingCurrency: item.currency,
                    category: item.category,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setNotice(
                    body.created
                        ? `Referencia guardada: ${item.title}. Revísala en Borradores.`
                        : `Esta referencia ya existe (${body.id}).`
                );
            } else {
                setError(body.error || "No se pudo guardar la referencia.");
            }
        } catch {
            setError("Error de red al guardar la referencia.");
        } finally {
            setImportingId(null);
        }
    };

    const openImport = (item: TrendItem) => {
        const source: ImportSource = item.source === "cjdropshipping" ? "cjdropshipping" : "aliexpress_ds";
        setSelection({ source, productId: item.sourceId });
        setView("import");
    };

    const query = search.trim().toLowerCase();
    const filteredItems = (data?.items ?? []).filter((item) => {
        if (sourceFilter && item.source !== sourceFilter) return false;
        if (!query) return true;
        return (
            item.title.toLowerCase().includes(query) ||
            (item.category ?? "").toLowerCase().includes(query)
        );
    });
    const filteredKeywords = (data?.keywords ?? []).filter(
        (k) => !query || k.keyword.toLowerCase().includes(query)
    );

    const inputClass =
        "w-full px-3 py-2 rounded-xl bg-surface-card border border-black/10 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary";

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-accent-dark" />
                        Tendencias &amp; Abastecimiento
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Descubre señales de demanda, consulta precio y stock reales del proveedor e
                        importa borradores listos para revisar.
                    </p>
                </div>
                <button
                    onClick={() => void handleRefresh()}
                    disabled={refreshing}
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-2 glow-purple transition-all disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    {refreshing ? "Actualizando..." : "Actualizar tendencias"}
                </button>
            </div>

            <nav className="flex flex-wrap gap-2" aria-label="Secciones de abastecimiento">
                {VIEWS.map((v) => (
                    <button
                        key={v.id}
                        type="button"
                        onClick={() => setView(v.id)}
                        aria-current={view === v.id ? "page" : undefined}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                            view === v.id
                                ? "bg-primary text-white"
                                : "bg-black/5 text-muted hover:text-foreground"
                        }`}
                    >
                        {v.label}
                    </button>
                ))}
            </nav>

            {error && (
                <div role="alert" className="p-3.5 rounded-2xl bg-red-500/15 border border-danger/30 text-danger text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {notice && (
                <div className="p-3.5 rounded-2xl bg-green-500/15 border border-success/30 text-success text-xs flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{notice}</span>
                </div>
            )}

            {view === "discover" && (
                <div className="space-y-5">
                    {data && data.sources.some((s) => s.status !== "ok") && (
                        <div className="space-y-1">
                            {data.sources
                                .filter((s) => s.status !== "ok")
                                .map((s) => (
                                    <p key={s.source} className="text-[11px] text-warning flex items-center gap-1.5">
                                        <AlertCircle className="w-3 h-3" />
                                        {SOURCE_LABELS[s.source] ?? s.source}: {s.message ?? s.status}
                                        {s.feedName ? ` (feed ${s.feedName})` : ""}
                                    </p>
                                ))}
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Filtrar resultados cargados por título o categoría..."
                                className={`${inputClass} pl-9`}
                                aria-label="Filtrar señales cargadas"
                            />
                        </div>
                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className={`${inputClass} sm:w-52`}
                            aria-label="Filtrar por fuente"
                        >
                            <option value="">Todas las fuentes</option>
                            {[...new Set((data?.items ?? []).map((i) => i.source))].map((s) => (
                                <option key={s} value={s}>
                                    {SOURCE_LABELS[s] ?? s}
                                </option>
                            ))}
                        </select>
                    </div>

                    {loading ? (
                        <p className="py-10 text-center text-muted text-sm animate-pulse">
                            Cargando tendencias...
                        </p>
                    ) : !data ? (
                        <p className="py-10 text-center text-muted text-sm">
                            No hay datos de tendencias.
                        </p>
                    ) : (
                        <>
                            {filteredKeywords.length > 0 && (
                                <div>
                                    <p className="text-[11px] text-muted mb-2">
                                        Búsquedas detectadas (referencia de demanda)
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {filteredKeywords.map((k, i) =>
                                            isHttpUrl(k.url) ? (
                                            <a
                                                key={`${k.keyword}-${i}`}
                                                href={k.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3 py-1.5 rounded-full bg-black/5 text-foreground text-[11px] hover:bg-primary/15 transition-colors"
                                            >
                                                {k.keyword}
                                            </a>
                                            ) : (
                                            <span
                                                key={`${k.keyword}-${i}`}
                                                className="px-3 py-1.5 rounded-full bg-black/5 text-foreground text-[11px]"
                                            >
                                                {k.keyword}
                                            </span>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}
                            {filteredItems.length === 0 ? (
                                <p className="py-8 text-center text-muted text-sm">
                                    {data.items.length === 0
                                        ? describeEmptyFeed(
                                              (data.sources.find((s) => s.status !== "ok")?.source ??
                                                  data.sources[0]?.source) ?? "mercadolibre",
                                              data.sources.find((s) => s.status !== "ok") ?? data.sources[0]
                                          )
                                        : "Sin resultados para el filtro aplicado a los datos cargados."}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {filteredItems.map((item) => {
                                        const isSupplier = SUPPLIER_SOURCES.has(item.source);
                                        return (
                                            <article
                                                key={item.id}
                                                className="glass rounded-2xl p-4 flex flex-col gap-2"
                                            >
                                                <div className="flex gap-3">
                                                    {item.image && isHttpUrl(item.image) && (
                                                        <Image
                                                            src={item.image}
                                                            alt=""
                                                            width={56}
                                                            height={56}
                                                            unoptimized
                                                            className="rounded-xl object-cover w-14 h-14 shrink-0"
                                                        />
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-semibold text-foreground line-clamp-2">
                                                            {item.title}
                                                        </p>
                                                        <p className="text-[10px] text-muted mt-0.5">
                                                            {SOURCE_LABELS[item.source] ?? item.source}
                                                            {" · "}
                                                            {SIGNAL_LABELS[item.signalType] ?? item.signalType}
                                                            {item.category ? ` · ${item.category}` : ""}
                                                        </p>
                                                    </div>
                                                </div>
                                                <p className="text-[11px] text-muted">
                                                    {item.price !== null
                                                        ? `${item.currency ?? ""} ${item.price}`
                                                        : "Sin precio"}
                                                    {item.rank !== null ? ` · ranking ${item.rank}` : ""}
                                                    {item.salesVolume !== null
                                                        ? ` · ${item.salesVolume} ventas reportadas`
                                                        : ""}
                                                </p>
                                                <div className="flex gap-2 mt-auto pt-1">
                                                    {isSupplier ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openImport(item)}
                                                            className="flex-1 px-3 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                                                        >
                                                            <PackagePlus className="w-3.5 h-3.5" />
                                                            Consultar e importar
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleSaveReference(item)}
                                                            disabled={importingId === item.id}
                                                            className="flex-1 px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                                                        >
                                                            <Bookmark className="w-3.5 h-3.5" />
                                                            {importingId === item.id
                                                                ? "Guardando..."
                                                                : "Guardar referencia"}
                                                        </button>
                                                    )}
                                                    {item.url && isHttpUrl(item.url) && (
                                                        <a
                                                            href={item.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="px-3 py-2 rounded-xl bg-black/5 text-muted hover:text-foreground text-xs flex items-center"
                                                            aria-label="Abrir en origen"
                                                        >
                                                            <Link2 className="w-3.5 h-3.5" />
                                                        </a>
                                                    )}
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                            <p className="text-[10px] text-muted">
                                Generado {new Date(data.generatedAt).toLocaleString("es-CO")} · solo
                                se muestran los datos cargados, no es una búsqueda completa del marketplace.
                            </p>
                        </>
                    )}
                </div>
            )}

            {view === "import" && (
                <SupplierImportPanel
                    selection={selection}
                    onImported={() => setView("drafts")}
                    onOpenCatalog={onOpenCatalog}
                />
            )}

            {view === "drafts" && (
                <div className="space-y-4">
                    {onOpenCatalog && (
                        <button
                            type="button"
                            onClick={onOpenCatalog}
                            className="text-[11px] text-accent-dark hover:underline"
                        >
                            Ir al catálogo completo →
                        </button>
                    )}
                    <ProductsPanel draftOnly />
                </div>
            )}

            {view === "connections" && (
                <SupplierConnectionsPanel
                    statuses={data?.sources ?? []}
                    onRefresh={() => void load()}
                    dsConnectResult={dsConnectResult}
                />
            )}
        </div>
    );
}
