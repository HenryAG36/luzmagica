"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
    AlertCircle,
    CheckCircle2,
    PackagePlus,
    RefreshCw,
    Search,
} from "lucide-react";
import { formatCOP } from "@/lib/utils";
import { isHttpUrl } from "@/lib/catalog/validate";
import { supplierPricing } from "@/lib/catalog/supplierImport";
import type { ImportSource, SupplierPreview } from "@/lib/catalog/supplierImport";

interface Props {
    selection: { source: ImportSource; productId: string } | null;
    onImported: () => void;
    onOpenCatalog?: () => void;
}

const SOURCE_OPTIONS: { value: ImportSource; label: string }[] = [
    { value: "aliexpress_ds", label: "AliExpress DS" },
    { value: "cjdropshipping", label: "CJ Dropshipping" },
];

const inputClass =
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-black/10 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary";

// Human-friendly Spanish labels for provider detail/attribute keys.
const DETAIL_LABELS: Record<string, string> = {
    product_sku: "SKU proveedor",
    weight_g: "Peso (g)",
    product_unit: "Unidad",
    materials: "Materiales",
    logistics_attributes: "Atributos logísticos",
    category_id: "ID de categoría",
    delivery_time_days: "Entrega estimada (días)",
    provider_reported_sales: "Ventas reportadas",
    variant_sku: "SKU variante",
    length_mm: "Largo (mm)",
    width_mm: "Ancho (mm)",
    height_mm: "Alto (mm)",
};

function detailLabel(key: string): string {
    return DETAIL_LABELS[key] ?? key.replace(/_/g, " ");
}

function cheapestFreight(preview: SupplierPreview): string | null {
    const known = preview.freight.filter((f) => f.feeUsd !== null);
    if (known.length === 0) return null;
    return known.reduce((a, b) => ((a.feeUsd ?? 0) <= (b.feeUsd ?? 0) ? a : b)).id;
}

export default function SupplierImportPanel({ selection, onImported, onOpenCatalog }: Props) {
    const [source, setSource] = useState<ImportSource>("aliexpress_ds");
    const [input, setInput] = useState("");
    const [preview, setPreview] = useState<SupplierPreview | null>(null);
    const [previewKey, setPreviewKey] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [importing, setImporting] = useState(false);
    const [variantId, setVariantId] = useState("");
    const [freightId, setFreightId] = useState<string | null>(null);
    const [margin, setMargin] = useState(15);
    const [priceOverride, setPriceOverride] = useState("");
    const [importedId, setImportedId] = useState<string | null>(null);
    const [importedCreated, setImportedCreated] = useState(false);

    const lookupSeq = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const inFlightKey = useRef<string | null>(null);
    const importSeq = useRef(0);

    // Clears displayed lookup state without touching request bookkeeping —
    // safe to call inside effects that immediately issue a new fetchPreview
    // (StrictMode double-invoke dedupes on the request key).
    const resetLookupView = useCallback(() => {
        setPreview(null);
        setPreviewKey("");
        setVariantId("");
        setFreightId(null);
        setPriceOverride("");
        setImportedId(null);
        setImportedCreated(false);
        setError("");
        setNotice("");
    }, []);

    // Invalidates any in-flight lookup AND its result. Call on every input
    // that changes request identity (source, product id, variant).
    const invalidateLookup = useCallback(() => {
        lookupSeq.current += 1;
        importSeq.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        inFlightKey.current = null;
        setLoading(false);
        resetLookupView();
    }, [resetLookupView]);

    // Unmount: abort and bump sequence only — no state updates.
    useEffect(
        () => () => {
            lookupSeq.current += 1;
            importSeq.current += 1;
            abortRef.current?.abort();
        },
        []
    );

    const fetchPreview = useCallback(
        async (src: ImportSource, productInput: string, variant?: string) => {
            const requestKey = `${src}:${productInput}:${variant ?? ""}`;
            // Dedupe only a live identical request; an aborted one (e.g. a
            // StrictMode cleanup) is re-issued so the preview still loads.
            const existing = abortRef.current;
            if (inFlightKey.current === requestKey && existing && !existing.signal.aborted) {
                return;
            }
            inFlightKey.current = requestKey;
            const seq = ++lookupSeq.current;
            existing?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setLoading(true);
            setError("");
            setNotice("");
            try {
                const res = await fetch("/api/admin/suppliers/preview", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ source: src, productId: productInput, variantId: variant }),
                    signal: controller.signal,
                });
                const body = await res.json().catch(() => ({}));
                if (seq !== lookupSeq.current) return; // stale response
                if (!res.ok) {
                    setPreview(null);
                    setPreviewKey("");
                    setError(body.error || `No se pudo consultar el proveedor (HTTP ${res.status}).`);
                    return;
                }
                const next = body.preview as SupplierPreview;
                setPreview(next);
                setPreviewKey(`${src}:${next.product.productId}:${next.selectedVariantId ?? ""}`);
                setVariantId(next.selectedVariantId ?? "");
                setFreightId(cheapestFreight(next));
                setPriceOverride("");
                setImportedId(null);
            } catch (e) {
                if ((e as Error).name === "AbortError") return;
                if (seq === lookupSeq.current) {
                    setPreview(null);
                    setError("Error de red al consultar el proveedor.");
                }
            } finally {
                if (inFlightKey.current === requestKey) inFlightKey.current = null;
                if (seq === lookupSeq.current) setLoading(false);
            }
        },
        []
    );

    // A card selection auto-queries and resets any previous preview state.
    // The effect cleanup invalidates its own request: under StrictMode the
    // first invocation's aborted fetch never reaches the network and the
    // re-invoked effect issues the real one.
    useEffect(() => {
        if (!selection) return;
        setSource(selection.source);
        setInput(selection.productId);
        resetLookupView();
        void fetchPreview(selection.source, selection.productId);
        return () => {
            lookupSeq.current += 1;
            importSeq.current += 1;
            inFlightKey.current = null;
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [selection, fetchPreview, resetLookupView]);

    const handleLookup = () => {
        const trimmed = input.trim();
        if (!trimmed || loading) return;
        invalidateLookup();
        void fetchPreview(source, trimmed);
    };

    const handleVariantChange = (next: string) => {
        lookupSeq.current += 1;
        importSeq.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        inFlightKey.current = null;
        setLoading(false);
        setVariantId(next);
        setFreightId(null);
        setPriceOverride("");
        setImportedId(null);
        setImportedCreated(false);
        if (!preview) return;
        const product = preview.product;
        if (!next) {
            // Clearing the variant keeps the loaded product but voids the
            // selection, freight and quote — import stays disabled.
            setPreview({ ...preview, selectedVariantId: null, freight: [], freightCheckedAt: null });
            setPreviewKey("");
            return;
        }
        void fetchPreview(source, product.productId, next);
    };

    // Manual price: blank = automatic suggestion; anything else must be a
    // valid positive integer COP — 0/negatives surface inline, never coerced.
    const manualPrice = priceOverride.trim() === "" ? undefined : Number(priceOverride);
    const manualPriceValid =
        manualPrice === undefined ||
        (Number.isSafeInteger(manualPrice) && manualPrice > 0 && manualPrice <= 2147483647);

    const pricing = preview
        ? supplierPricing(preview, {
              marginPercent: margin,
              freightId,
              priceCop: manualPriceValid ? manualPrice : undefined,
          })
        : null;

    const isStalePreview =
        !preview || previewKey !== `${source}:${preview.product.productId}:${variantId || ""}`;

    const canImport =
        !!preview && !loading && !importing && !isStalePreview && !!variantId && manualPriceValid;

    const handleImport = async () => {
        if (!preview || !canImport) return;
        const seq = ++importSeq.current;
        setImporting(true);
        setError("");
        setNotice("");
        try {
            const res = await fetch("/api/admin/catalog/import-supplier", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    source,
                    productId: preview.product.productId,
                    variantId,
                    freightId,
                    marginPercent: margin,
                    priceCop: manualPrice,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (seq !== importSeq.current) return; // invalidated while importing
            if (!res.ok) {
                setError(body.error || `No se pudo importar (HTTP ${res.status}).`);
                return;
            }
            setImportedId(body.id ?? null);
            setImportedCreated(body.created === true);
            const warns = Array.isArray(body.warnings) && body.warnings.length
                ? ` Avisos: ${body.warnings.join(" ")}`
                : "";
            setNotice(
                body.created
                    ? `Borrador creado (${body.id}).${warns}`
                    : `Este producto ya existía; el borrador existente no se modificó (${body.id}).`
            );
        } catch {
            setError("Error de red al importar.");
        } finally {
            setImporting(false);
        }
    };

    const product = preview?.product ?? null;

    return (
        <div className="space-y-6">
            <div className="glass rounded-3xl p-6 md:p-8 space-y-4">
                <h4 className="font-heading text-base font-bold text-foreground">
                    Consultar producto del proveedor
                </h4>
                <p className="text-[11px] text-muted">
                    Pega un ID de producto o una URL de producto (aliexpress.com/item/… o
                    cjdropshipping.com/…-p-….html). El servidor consulta la API oficial y
                    devuelve precio, stock y variantes verificados.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                    <select
                        value={source}
                        onChange={(e) => {
                            setSource(e.target.value as ImportSource);
                            invalidateLookup();
                        }}
                        disabled={importing}
                        className={`${inputClass} sm:w-48`}
                        aria-label="Proveedor"
                    >
                        {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                    <input
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            invalidateLookup();
                        }}
                        disabled={importing}
                        placeholder="ID de producto o URL del proveedor"
                        className={inputClass}
                        maxLength={2048}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleLookup();
                        }}
                    />
                    <button
                        type="button"
                        onClick={handleLookup}
                        disabled={loading || !input.trim()}
                        className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-all disabled:opacity-50 shrink-0 flex items-center gap-2"
                    >
                        {loading ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Search className="w-3.5 h-3.5" />
                        )}
                        {loading ? "Consultando..." : "Consultar"}
                    </button>
                </div>
            </div>

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

            {preview && product && (
                <div className="glass rounded-3xl p-6 md:p-8 space-y-5">
                    {/* Product summary */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        {product.images[0] && isHttpUrl(product.images[0]) && (
                            <Image
                                src={product.images[0]}
                                alt={product.title}
                                width={96}
                                height={96}
                                unoptimized
                                className="rounded-2xl object-cover w-24 h-24 shrink-0"
                            />
                        )}
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{product.title}</p>
                            <p className="text-[11px] text-muted mt-1 break-all">
                                ID {product.productId}
                                {product.category ? ` · ${product.category}` : ""}
                            </p>
                            {product.sourceUrl && isHttpUrl(product.sourceUrl) && (
                                <a
                                    href={product.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] text-accent-dark hover:underline"
                                >
                                    Ver en el proveedor
                                </a>
                            )}
                            <p className="text-[10px] text-muted mt-1">
                                Datos consultados {new Date(product.fetchedAt).toLocaleString("es-CO")}
                            </p>
                        </div>
                    </div>

                    {/* Gallery */}
                    {product.images.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Imágenes del proveedor">
                            {product.images.map((src, i) =>
                                isHttpUrl(src) ? (
                                    <Image
                                        key={i}
                                        src={src}
                                        alt=""
                                        width={56}
                                        height={56}
                                        unoptimized
                                        className="rounded-lg object-cover w-14 h-14 shrink-0 border border-black/10"
                                    />
                                ) : null
                            )}
                        </div>
                    )}

                    {product.description && (
                        <p className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {product.description}
                        </p>
                    )}

                    {Object.keys(product.details).length > 0 && (
                        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            {Object.entries(product.details).map(([k, v]) =>
                                v === null || v === undefined ? null : (
                                    <div key={k} className="rounded-lg bg-surface px-2 py-1.5">
                                        <dt className="text-muted">{detailLabel(k)}</dt>
                                        <dd className="text-foreground font-medium break-words">{String(v)}</dd>
                                    </div>
                                )
                            )}
                        </dl>
                    )}

                    {/* Variant selector */}
                    <div>
                        <label className="text-[11px] text-muted block mb-1">Variante *</label>
                        {product.variants.length > 1 ? (
                            <select
                                value={variantId}
                                onChange={(e) => handleVariantChange(e.target.value)}
                                disabled={importing}
                                className={inputClass}
                            >
                                <option value="">Selecciona variante…</option>
                                {product.variants.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.label}
                                        {v.price !== null ? ` · ${v.price} ${v.currency ?? ""}` : ""}
                                        {v.stock !== null ? ` · stock ${v.stock}` : " · stock desconocido"}
                                    </option>
                                ))}
                            </select>
                        ) : product.variants.length === 1 ? (
                            <p className="text-[11px] text-muted">
                                {product.variants[0].label}
                                {product.variants[0].stock !== null
                                    ? ` · stock ${product.variants[0].stock}`
                                    : " · stock desconocido"}
                                {product.variants[0].price !== null &&
                                    ` · ${product.variants[0].price} ${product.variants[0].currency ?? ""}`}
                            </p>
                        ) : (
                            <p className="text-[11px] text-warning">Sin variantes disponibles.</p>
                        )}
                    </div>

                    {/* Freight */}
                    <div className="rounded-xl border border-black/10 p-3 space-y-2">
                        <p className="text-[11px] font-semibold text-foreground">
                            Envío al cliente · destino {preview.freightDestination}
                            {preview.freightCheckedAt &&
                                ` · cotizado ${new Date(preview.freightCheckedAt).toLocaleString("es-CO")}`}
                        </p>
                        {preview.freight.length === 0 ? (
                            <p className="text-[11px] text-warning">
                                Sin opciones de envío; quedará pendiente en el borrador.
                            </p>
                        ) : (
                            <select
                                value={freightId ?? ""}
                                onChange={(e) => setFreightId(e.target.value || null)}
                                disabled={importing}
                                className={inputClass}
                                aria-label="Opción de envío"
                            >
                                <option value="">Sin envío seleccionado</option>
                                {preview.freight.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                        {f.feeUsd !== null ? ` · US $${f.feeUsd}` : " · tarifa desconocida"}
                                        {f.delivery ? ` · ${f.delivery}` : ""}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* FX */}
                    <p className="text-[10px] text-muted">
                        {preview.fx
                            ? `Tasa USD→COP ${preview.fx.rate} (${preview.fx.date}) · `
                            : "Tasa USD→COP no disponible · "}
                        <a
                            href="https://www.exchangerate-api.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-dark hover:underline"
                        >
                            Rates By Exchange Rate API
                        </a>
                    </p>

                    {/* Pricing */}
                    {pricing?.variant && (
                        <div className="rounded-xl border border-black/10 p-3 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] text-muted block mb-1">
                                        Margen objetivo ({margin}%)
                                    </label>
                                    <input
                                        type="range"
                                        min={15}
                                        max={50}
                                        step={1}
                                        value={margin}
                                        disabled={importing}
                                        onChange={(e) => setMargin(Number(e.target.value))}
                                        className="w-full accent-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-muted block mb-1">
                                        Precio de venta COP (vacío = sugerido)
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={priceOverride}
                                        onChange={(e) => setPriceOverride(e.target.value)}
                                        disabled={importing}
                                        placeholder={
                                            pricing.suggestion
                                                ? String(pricing.suggestion.customerProduct)
                                                : "Pendiente"
                                        }
                                        className={inputClass}
                                    />
                                    {!manualPriceValid && (
                                        <p role="alert" className="text-[10px] text-danger mt-1">
                                            Ingresa un precio entero en COP mayor que 0.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Costo producto</dt>
                                    <dd className="text-foreground font-medium">
                                        {pricing.cost !== null ? formatCOP(pricing.cost) : "Desconocido"}
                                    </dd>
                                </div>
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Envío (costo)</dt>
                                    <dd className="text-foreground font-medium">
                                        {pricing.shipping !== null ? formatCOP(pricing.shipping) : "Pendiente"}
                                    </dd>
                                </div>
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Costo total estimado</dt>
                                    <dd className="text-foreground font-medium">
                                        {pricing.cost !== null && pricing.shipping !== null
                                            ? formatCOP(pricing.cost + pricing.shipping)
                                            : "Pendiente"}
                                    </dd>
                                </div>
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Precio producto</dt>
                                    <dd className="text-foreground font-medium">
                                        {manualPrice !== undefined && manualPriceValid
                                            ? formatCOP(manualPrice)
                                            : pricing.suggestion
                                              ? formatCOP(pricing.suggestion.customerProduct)
                                              : "Pendiente"}
                                    </dd>
                                </div>
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Envío cliente</dt>
                                    <dd className="text-foreground font-medium">
                                        {pricing.shipping !== null ? formatCOP(pricing.shipping) : "Pendiente"}
                                    </dd>
                                </div>
                                <div className="rounded-lg bg-surface px-2 py-1.5">
                                    <dt className="text-muted">Total cliente estimado</dt>
                                    <dd className="text-foreground font-medium">
                                        {pricing.shipping !== null &&
                                        (manualPrice !== undefined && manualPriceValid
                                            ? true
                                            : pricing.suggestion)
                                            ? formatCOP(
                                                  (manualPrice !== undefined && manualPriceValid
                                                      ? manualPrice
                                                      : pricing.suggestion!.customerProduct) +
                                                      pricing.shipping
                                              )
                                            : "Pendiente"}
                                    </dd>
                                </div>
                            </dl>
                            <p className="text-[10px] text-muted">
                                {pricing.suggestion
                                    ? `Sugerido ${formatCOP(pricing.suggestion.customerProduct)} al ${margin}% de margen. `
                                    : ""}
                                Impuestos adicionales y comisiones de pasarela no incluidos; revisa los cargos de la cotización.
                            </p>
                        </div>
                    )}

                    {/* Warnings */}
                    {preview.warnings.length > 0 && (
                        <ul className="space-y-1">
                            {preview.warnings.map((w, i) => (
                                <li key={i} className="flex items-start gap-2 text-[11px] text-warning">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>{w}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => void handleImport()}
                            disabled={!canImport}
                            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
                        >
                            <PackagePlus className="w-3.5 h-3.5" />
                            {importing ? "Importando..." : "Importar como borrador"}
                        </button>
                        {importedId && importedCreated && (
                            <button
                                type="button"
                                onClick={onImported}
                                className="px-4 py-2.5 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs font-semibold hover:bg-black/5"
                            >
                                Ver borradores
                            </button>
                        )}
                        {importedId && !importedCreated && onOpenCatalog && (
                            <button
                                type="button"
                                onClick={onOpenCatalog}
                                className="px-4 py-2.5 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs font-semibold hover:bg-black/5"
                            >
                                Ver catálogo
                            </button>
                        )}
                        {!canImport && !loading && product.variants.length > 1 && !variantId && (
                            <p className="text-[11px] text-warning">Elige una variante para importar.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
