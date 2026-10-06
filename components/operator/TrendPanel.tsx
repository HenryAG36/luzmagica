"use client";

import { useCallback, useEffect, useState } from "react";
import {
    TrendingUp,
    RefreshCw,
    ExternalLink,
    AlertCircle,
    CheckCircle2,
    PlugZap,
    PackagePlus,
    PackageCheck,
    Globe,
} from "lucide-react";
import Image from "next/image";
import { formatCOP } from "@/lib/utils";
import type { TrendItem, TrendsPayload } from "@/lib/trends/types";
import type { CatalogRow } from "@/lib/catalog/validate";
import { isHttpUrl } from "@/lib/catalog/validate";

const SOURCE_LABELS: Record<string, string> = {
    mercadolibre: "Mercado Libre",
    aliexpress: "AliExpress",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
    ok: { label: "Activa", className: "bg-green-500/15 text-green-300 border-green-500/30" },
    disabled: { label: "Sin configurar", className: "bg-white/10 text-muted border-white/10" },
    error: { label: "Error", className: "bg-red-500/15 text-red-300 border-red-500/30" },
    stale: { label: "Datos antiguos", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

interface ReviewForm {
    name: string;
    category: string;
    room: string;
    type: string;
    description: string;
    priceCop: string;
    stock: string;
    imagesText: string;
    supplierCostCop: string;
    shippingCop: string;
    taxesFeesCop: string;
    fxRate: string;
    fxRateDate: string;
    supplierRightsConfirmed: boolean;
}

function emptyReview(draft: CatalogRow): ReviewForm {
    return {
        name: draft.name,
        category: draft.category,
        room: draft.room,
        type: draft.type,
        description: draft.description,
        priceCop: draft.price_cop ? String(draft.price_cop) : "",
        stock: draft.stock ? String(draft.stock) : "",
        imagesText: (draft.images ?? []).join("\n"),
        supplierCostCop: draft.supplier_cost_cop ? String(draft.supplier_cost_cop) : "",
        shippingCop: draft.supplier_shipping_cop ? String(draft.supplier_shipping_cop) : "",
        taxesFeesCop: draft.taxes_fees_cop ? String(draft.taxes_fees_cop) : "",
        fxRate: draft.fx_rate ? String(draft.fx_rate) : "",
        fxRateDate: draft.fx_rate_date ?? "",
        supplierRightsConfirmed: draft.supplier_rights_confirmed === true,
    };
}

export default function TrendPanel() {
    const [data, setData] = useState<TrendsPayload | null>(null);
    const [drafts, setDrafts] = useState<CatalogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [importingId, setImportingId] = useState<string | null>(null);
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        setError("");
        try {
            const [trendsRes, draftsRes] = await Promise.all([
                fetch("/api/admin/trends"),
                fetch("/api/admin/catalog"),
            ]);
            if (trendsRes.ok) setData(await trendsRes.json());
            else setError(`No se pudieron cargar las tendencias (HTTP ${trendsRes.status}).`);
            if (draftsRes.ok) {
                const body = await draftsRes.json();
                setDrafts(body.drafts ?? []);
            }
        } catch {
            setError("Error de red al cargar tendencias.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setNotice("");
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

    const handleImport = async (item: TrendItem) => {
        setImportingId(item.id);
        setNotice("");
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
            if (res.ok) {
                const body = await res.json();
                setNotice(
                    body.created
                        ? `Borrador creado: ${item.title}. Revisa y publica desde la lista de borradores.`
                        : `Este producto ya existe como borrador o publicado (${body.id}).`
                );
                const draftsRes = await fetch("/api/admin/catalog");
                if (draftsRes.ok) setDrafts((await draftsRes.json()).drafts ?? []);
            } else {
                const body = await res.json().catch(() => ({}));
                setError(body.error || "No se pudo importar el producto.");
            }
        } catch {
            setError("Error de red al importar.");
        } finally {
            setImportingId(null);
        }
    };

    const reviewFields = (form: ReviewForm) => ({
        name: form.name,
        category: form.category,
        room: form.room,
        type: form.type,
        description: form.description,
        price_cop: Number(form.priceCop) || 0,
        stock: Number(form.stock) || 0,
        images: form.imagesText.split("\n").map((s) => s.trim()).filter(Boolean),
        supplier_cost_cop: form.supplierCostCop ? Number(form.supplierCostCop) : null,
        supplier_shipping_cop: form.shippingCop ? Number(form.shippingCop) : null,
        taxes_fees_cop: form.taxesFeesCop ? Number(form.taxesFeesCop) : null,
        fx_rate: form.fxRate ? Number(form.fxRate) : null,
        fx_rate_date: form.fxRateDate || null,
        supplier_rights_confirmed: form.supplierRightsConfirmed,
    });

    const handlePublish = async (draft: CatalogRow) => {
        if (!reviewForm) return;
        setSubmitting(true);
        setError("");
        try {
            const res = await fetch(`/api/admin/catalog/${draft.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "publish", fields: reviewFields(reviewForm) }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setNotice(`"${draft.name}" publicado en el catálogo.`);
                setReviewingId(null);
                setReviewForm(null);
                setDrafts(drafts.filter((d) => d.id !== draft.id));
            } else {
                setError(
                    body.missing
                        ? `Faltan campos para publicar: ${(body.missing as string[]).join(", ")}`
                        : body.error || "No se pudo publicar."
                );
            }
        } catch {
            setError("Error de red al publicar.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDiscard = async (draft: CatalogRow) => {
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/catalog/${draft.id}`, { method: "DELETE" });
            if (res.ok) setDrafts(drafts.filter((d) => d.id !== draft.id));
        } finally {
            setSubmitting(false);
        }
    };

    const marginPreview = (form: ReviewForm): number | null => {
        const price = Number(form.priceCop) || 0;
        if (!price || !form.supplierCostCop || !form.shippingCop || !form.taxesFeesCop) return null;
        return price - Number(form.supplierCostCop) - Number(form.shippingCop) - Number(form.taxesFeesCop);
    };

    const meliItems = data?.items.filter((i) => i.source === "mercadolibre") ?? [];
    const aliItems = data?.items.filter((i) => i.source === "aliexpress") ?? [];

    const inputClass =
        "w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary";

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-white flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-accent" />
                        Tendencias & Abastecimiento
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Señales de demanda (búsquedas y más vendidos) separadas de candidatos de proveedor. Los datos se actualizan automáticamente cada 6 horas al usar el panel.
                    </p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-2 glow-purple transition-all disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    {refreshing ? "Actualizando..." : "Actualizar ahora"}
                </button>
            </div>

            <div className="flex flex-wrap gap-2">
                {(data?.sources ?? []).map((s) => {
                    const meta = STATUS_LABELS[s.status] || STATUS_LABELS.stale;
                    return (
                        <div
                            key={s.source}
                            className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 ${meta.className}`}
                            title={s.message || ""}
                        >
                            <Globe className="w-3.5 h-3.5" />
                            <span className="font-semibold">{SOURCE_LABELS[s.source] || s.source}</span>
                            <span>{meta.label}</span>
                            {s.fetchedAt && (
                                <span className="text-[10px] opacity-70">
                                    {new Date(s.fetchedAt).toLocaleString("es-CO")}
                                </span>
                            )}
                        </div>
                    );
                })}
                <a
                    href="/api/admin/providers/meli/authorize"
                    className="px-3 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary text-xs flex items-center gap-2 hover:bg-primary/20 transition-colors"
                >
                    <PlugZap className="w-3.5 h-3.5" />
                    Conectar Mercado Libre
                </a>
            </div>

            {error && (
                <div className="p-3.5 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {notice && (
                <div className="p-3.5 rounded-2xl bg-green-500/15 border border-green-500/30 text-green-200 text-xs flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{notice}</span>
                </div>
            )}

            {loading ? (
                <div className="py-16 text-center text-muted text-sm animate-pulse">
                    Cargando tendencias...
                </div>
            ) : (
                <>
                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="font-heading text-base font-bold text-white mb-4">
                            Tendencias de búsqueda · Mercado Libre Colombia
                        </h4>
                        {(data?.keywords.length ?? 0) === 0 ? (
                            <p className="text-xs text-muted">
                                Sin datos de búsqueda. Conecta Mercado Libre para activar esta fuente.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {data!.keywords.filter((k) => isHttpUrl(k.url)).map((k) => (
                                    <a
                                        key={`${k.keyword}-${k.url}`}
                                        href={k.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-primary/20 border border-white/10 hover:border-primary/40 text-xs text-white transition-all flex items-center gap-1.5"
                                    >
                                        {k.keyword}
                                        <ExternalLink className="w-3 h-3 text-muted" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="font-heading text-base font-bold text-white mb-1">
                            Más vendidos · Mercado Libre Colombia
                        </h4>
                        <p className="text-[11px] text-muted mb-4">
                            Señal de demanda: posición en el ranking de la categoría. No representa unidades vendidas exactas.
                        </p>
                        {meliItems.length === 0 ? (
                            <p className="text-xs text-muted">Sin datos de más vendidos.</p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {meliItems.map((item) => (
                                    <TrendCard key={item.id} item={item} onImport={handleImport} importing={importingId === item.id} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="font-heading text-base font-bold text-white mb-1">
                            Productos calientes · AliExpress (candidatos de proveedor)
                        </h4>
                        <p className="text-[11px] text-muted mb-4">
                            Precios en moneda original del proveedor. El precio de lista no garantiza costo mayorista ni idoneidad para dropshipping; la similitud de palabras clave no verifica identidad de producto.
                        </p>
                        {aliItems.length === 0 ? (
                            <p className="text-xs text-muted">
                                Sin datos. Configura las credenciales de AliExpress Affiliate para activar esta fuente.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {aliItems.map((item) => (
                                    <TrendCard key={item.id} item={item} onImport={handleImport} importing={importingId === item.id} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="font-heading text-base font-bold text-white mb-4 flex items-center gap-2">
                            <PackageCheck className="w-4 h-4 text-primary" />
                            Borradores de catálogo ({drafts.length})
                        </h4>
                        {drafts.length === 0 ? (
                            <p className="text-xs text-muted">
                                No hay borradores pendientes. Importa un producto desde las señales de arriba.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {drafts.map((draft) => {
                                    const isReviewing = reviewingId === draft.id;
                                    const margin = reviewForm && isReviewing ? marginPreview(reviewForm) : null;
                                    return (
                                        <div
                                            key={draft.id}
                                            className="p-4 rounded-2xl bg-surface-card border border-white/10"
                                        >
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-white truncate">{draft.name}</div>
                                                    <div className="text-[11px] text-muted mt-0.5">
                                                        {SOURCE_LABELS[draft.source] || draft.source} · {draft.provider_item_id}
                                                        {draft.listing_price != null && (
                                                            <span> · Lista: {draft.listing_price} {draft.listing_currency}</span>
                                                        )}
                                                    </div>
                                                    {draft.source_url && isHttpUrl(draft.source_url) && (
                                                        <a
                                                            href={draft.source_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[11px] text-primary hover:underline flex items-center gap-1 mt-0.5"
                                                        >
                                                            Ver en origen <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                </div>
                                                <div className="flex gap-2 shrink-0">
                                                    <button
                                                        onClick={() => {
                                                            setReviewingId(isReviewing ? null : draft.id);
                                                            setReviewForm(isReviewing ? null : emptyReview(draft));
                                                        }}
                                                        className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors"
                                                    >
                                                        {isReviewing ? "Cerrar" : "Revisar"}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDiscard(draft)}
                                                        disabled={submitting}
                                                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-red-500/20 text-muted hover:text-red-400 text-xs transition-colors disabled:opacity-50"
                                                    >
                                                        Descartar
                                                    </button>
                                                </div>
                                            </div>

                                            {isReviewing && reviewForm && (
                                                <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Título *</label>
                                                            <input value={reviewForm.name} onChange={(e) => setReviewForm({ ...reviewForm, name: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Categoría *</label>
                                                            <input value={reviewForm.category} onChange={(e) => setReviewForm({ ...reviewForm, category: e.target.value })} className={inputClass} placeholder="Ej: lamparas" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Habitación</label>
                                                            <input value={reviewForm.room} onChange={(e) => setReviewForm({ ...reviewForm, room: e.target.value })} className={inputClass} placeholder="Ej: dormitorio" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Tipo</label>
                                                            <input value={reviewForm.type} onChange={(e) => setReviewForm({ ...reviewForm, type: e.target.value })} className={inputClass} placeholder="Ej: lampara" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Precio de venta COP *</label>
                                                            <input type="number" min={0} value={reviewForm.priceCop} onChange={(e) => setReviewForm({ ...reviewForm, priceCop: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Stock verificado *</label>
                                                            <input type="number" min={0} value={reviewForm.stock} onChange={(e) => setReviewForm({ ...reviewForm, stock: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Costo proveedor COP</label>
                                                            <input type="number" min={0} value={reviewForm.supplierCostCop} onChange={(e) => setReviewForm({ ...reviewForm, supplierCostCop: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Envío proveedor COP</label>
                                                            <input type="number" min={0} value={reviewForm.shippingCop} onChange={(e) => setReviewForm({ ...reviewForm, shippingCop: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Impuestos y tarifas COP</label>
                                                            <input type="number" min={0} value={reviewForm.taxesFeesCop} onChange={(e) => setReviewForm({ ...reviewForm, taxesFeesCop: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Tasa USD→COP (opcional)</label>
                                                            <input type="number" min={0} step="0.01" value={reviewForm.fxRate} onChange={(e) => setReviewForm({ ...reviewForm, fxRate: e.target.value })} className={inputClass} />
                                                        </div>
                                                        <div>
                                                            <label className="text-[11px] text-muted block mb-1">Fecha de la tasa</label>
                                                            <input type="date" value={reviewForm.fxRateDate} onChange={(e) => setReviewForm({ ...reviewForm, fxRateDate: e.target.value })} className={inputClass} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-muted block mb-1">Imágenes permitidas (URLs http/https, una por línea) *</label>
                                                        <textarea
                                                            value={reviewForm.imagesText}
                                                            onChange={(e) => setReviewForm({ ...reviewForm, imagesText: e.target.value })}
                                                            rows={3}
                                                            className={inputClass}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-muted block mb-1">Descripción *</label>
                                                        <textarea
                                                            value={reviewForm.description}
                                                            onChange={(e) => setReviewForm({ ...reviewForm, description: e.target.value })}
                                                            rows={3}
                                                            className={inputClass}
                                                        />
                                                    </div>
                                                    {margin !== null && (
                                                        <div className={`text-xs font-mono ${margin >= 0 ? "text-green-400" : "text-red-400"}`}>
                                                            Margen estimado: {formatCOP(margin)} (precio − costo − envío − impuestos)
                                                        </div>
                                                    )}
                                                    <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={reviewForm.supplierRightsConfirmed}
                                                            onChange={(e) => setReviewForm({ ...reviewForm, supplierRightsConfirmed: e.target.checked })}
                                                            className="mt-0.5"
                                                        />
                                                        <span>Confirmo que tengo derecho a usar las imágenes y datos del proveedor y que el stock fue verificado antes de publicar. *</span>
                                                    </label>
                                                    <button
                                                        onClick={() => handlePublish(draft)}
                                                        disabled={submitting}
                                                        className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        {submitting ? "Publicando..." : "Publicar al catálogo"}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function TrendCard({
    item,
    onImport,
    importing,
}: {
    item: TrendItem;
    onImport: (item: TrendItem) => void;
    importing: boolean;
}) {
    const [imageError, setImageError] = useState(false);
    const safeImage = item.image && isHttpUrl(item.image) ? item.image : null;
    const safeUrl = item.url && isHttpUrl(item.url) ? item.url : null;

    return (
        <div className="p-4 rounded-2xl bg-surface-card border border-white/10 flex flex-col gap-3">
            <div className="flex gap-3">
                <div className="w-14 h-14 rounded-xl bg-surface border border-white/5 overflow-hidden shrink-0 flex items-center justify-center relative">
                    {safeImage && !imageError ? (
                        <Image
                            src={safeImage}
                            alt=""
                            fill
                            unoptimized
                            sizes="56px"
                            onError={() => setImageError(true)}
                            className="object-cover"
                        />
                    ) : (
                        <span className="text-xl opacity-50">📦</span>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="text-xs font-semibold text-white line-clamp-2">{item.title}</div>
                    <div className="text-[11px] text-muted mt-1 space-x-2">
                        {item.rank !== null && <span>Rank #{item.rank}</span>}
                        {item.price !== null && (
                            <span className="font-mono text-white">
                                {item.price} {item.currency}
                            </span>
                        )}
                        {item.salesVolume !== null && (
                            <span>· Vol. {item.salesVolume}</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-between mt-auto">
                {safeUrl ? (
                    <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                        Ver origen <ExternalLink className="w-3 h-3" />
                    </a>
                ) : (
                    <span />
                )}
                <button
                    onClick={() => onImport(item)}
                    disabled={importing}
                    className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                    <PackagePlus className="w-3.5 h-3.5" />
                    {importing ? "Importando..." : "Importar"}
                </button>
            </div>
        </div>
    );
}
