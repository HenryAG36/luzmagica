"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import type { DsFreightQuote, DsProduct } from "@/lib/suppliers/types";
import { isHttpUrl } from "@/lib/catalog/validate";
import { describePublishError } from "@/lib/catalog/publishFeedback";
import { describeEmptyFeed } from "@/lib/trends/emptyFeed";
import { computeActualContribution, computePriceSuggestion, resolveUsdAmount, usdToCop } from "@/lib/catalog/pricing";

const SOURCE_LABELS: Record<string, string> = {
    mercadolibre: "Mercado Libre",
    aliexpress: "AliExpress",
    aliexpress_ds: "AliExpress DS",
    cjdropshipping: "CJ Dropshipping",
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
    const [publishError, setPublishError] = useState("");
    const [dsProductId, setDsProductId] = useState("");
    const [dsProduct, setDsProduct] = useState<DsProduct | null>(null);
    const [dsSkuId, setDsSkuId] = useState("");
    const [dsBusy, setDsBusy] = useState(false);
    const [dsFreight, setDsFreight] = useState<DsFreightQuote | null>(null);
    const [dsFreightLoading, setDsFreightLoading] = useState(false);
    const [dsFreightError, setDsFreightError] = useState("");
    const [dsFreightIdx, setDsFreightIdx] = useState<number | null>(null);
    const [dsFxRate, setDsFxRate] = useState("");
    const [dsFxRateDate, setDsFxRateDate] = useState("");
    const [dsMargin, setDsMargin] = useState(15);
    const [dsPrice, setDsPrice] = useState("");
    const [dsPriceDirty, setDsPriceDirty] = useState(false);
    const [dsDiag, setDsDiag] = useState<string | null>(null);
    const [dsDiagBusy, setDsDiagBusy] = useState(false);
    const [dsDiagCopied, setDsDiagCopied] = useState(false);
    const dsFreightSeq = useRef(0);
    const searchParams = useSearchParams();
    const dsConnectResult = searchParams.get("ae_ds");

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

    const handleDsLookup = async () => {
        const id = dsProductId.trim();
        if (!id) return;
        await runDsLookup(id);
    };

    const runDsLookup = async (productId: string) => {
        setDsBusy(true);
        setError("");
        setNotice("");
        setDsProduct(null);
        setDsSkuId("");
        dsFreightSeq.current += 1;
        setDsFreight(null);
        setDsFreightError("");
        setDsFreightIdx(null);
        setDsPrice("");
        setDsPriceDirty(false);
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/product", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ productId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo consultar el producto.");
                return;
            }
            setDsProduct(body.product);
            setDsSkuId(body.product?.skus?.length === 1 ? body.product.skus[0].skuId : "");
        } catch {
            setError("Error de red al consultar el producto.");
        } finally {
            setDsBusy(false);
        }
    };

    const loadDsFreight = useCallback(async (productId: string, skuId: string) => {
        const seq = ++dsFreightSeq.current;
        setDsFreightLoading(true);
        setDsFreightError("");
        setDsFreight(null);
        setDsFreightIdx(null);
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/freight", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ productId, skuId }),
            });
            const body = await res.json().catch(() => ({}));
            if (seq !== dsFreightSeq.current) return;
            if (!res.ok) {
                setDsFreightError(body.error || "No se pudo consultar el flete.");
                return;
            }
            setDsFreight(body.quote ?? null);
        } catch {
            if (seq === dsFreightSeq.current) setDsFreightError("Error de red al consultar el flete.");
        } finally {
            if (seq === dsFreightSeq.current) setDsFreightLoading(false);
        }
    }, []);

    useEffect(() => {
        if (dsProduct && dsSkuId) {
            void loadDsFreight(dsProduct.productId, dsSkuId);
        } else {
            dsFreightSeq.current += 1;
            setDsFreight(null);
            setDsFreightError("");
            setDsFreightLoading(false);
            setDsFreightIdx(null);
        }
        setDsPrice("");
        setDsPriceDirty(false);
    }, [dsProduct, dsSkuId, loadDsFreight]);

    const dsSelectedSku = dsProduct
        ? dsProduct.skus.find((s) => s.skuId === dsSkuId) ??
          (dsProduct.skus.length === 1 ? dsProduct.skus[0] : null)
        : null;
    const dsCurrentQuote =
        dsFreight !== null &&
        dsProduct !== null &&
        dsSelectedSku !== null &&
        dsFreight.productId === dsProduct.productId &&
        dsFreight.skuId === dsSelectedSku.skuId
            ? dsFreight
            : null;
    const dsSelectedOption =
        dsCurrentQuote && dsFreightIdx !== null
            ? dsCurrentQuote.options[dsFreightIdx] ?? null
            : null;
    const dsFxRateNum = Number(dsFxRate);
    const dsFxReady =
        dsFxRate.trim() !== "" &&
        Number.isFinite(dsFxRateNum) &&
        dsFxRateNum > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(dsFxRateDate);
    const dsSkuInStock =
        dsSelectedSku !== null &&
        (dsSelectedSku.availableStock === null || dsSelectedSku.availableStock > 0);
    const dsSupplierUsd = dsSkuInStock
        ? resolveUsdAmount(
              dsSelectedSku
                  ? dsSelectedSku.offerSalePrice ?? dsSelectedSku.skuPrice
                  : null,
              dsSelectedSku?.currency ?? null,
              dsProduct?.currency ?? null
          )
        : null;
    const dsCostCop =
        dsFxReady && dsSupplierUsd !== null ? usdToCop(dsSupplierUsd, dsFxRateNum) : null;
    const dsShipCop =
        dsFxReady && dsSelectedOption?.feeUsd != null
            ? usdToCop(dsSelectedOption.feeUsd, dsFxRateNum)
            : null;
    const dsSuggestion =
        dsCostCop !== null && dsShipCop !== null
            ? computePriceSuggestion({
                  supplierCostCop: dsCostCop,
                  shippingCop: dsShipCop,
                  taxesFeesCop: null,
                  paymentFeePercent: null,
                  targetMarginPercent: dsMargin,
              })
            : null;
    const dsPriceNum = Number(dsPrice);
    const dsActualContribution =
        dsPrice.trim() !== "" && Number.isFinite(dsPriceNum)
            ? computeActualContribution(dsPriceNum, dsCostCop)
            : null;

    const dsSuggestedPrice = dsSuggestion?.customerProduct ?? null;
    useEffect(() => {
        if (!dsPriceDirty) {
            setDsPrice(dsSuggestedPrice !== null ? String(dsSuggestedPrice) : "");
        }
    }, [dsSuggestedPrice, dsPriceDirty]);

    const applyDsSuggestion = (marginPercent: number) => {
        const suggestion =
            dsCostCop !== null && dsShipCop !== null
                ? computePriceSuggestion({
                      supplierCostCop: dsCostCop,
                      shippingCop: dsShipCop,
                      taxesFeesCop: null,
                      paymentFeePercent: null,
                      targetMarginPercent: marginPercent,
                  })
                : null;
        if (suggestion) setDsPrice(String(suggestion.customerProduct));
    };

    const handleDsImport = async () => {
        if (!dsProduct) return;
        const sku = dsProduct.skus.find((s) => s.skuId === dsSkuId);
        if (dsProduct.skus.length > 1 && !sku) {
            setError("Selecciona una variante (SKU) antes de importar.");
            return;
        }
        const chosen = sku ?? dsProduct.skus[0] ?? null;
        if (dsProduct.skus.length >= 1 && !chosen) {
            setError("Selecciona una variante (SKU) antes de importar.");
            return;
        }
        setDsBusy(true);
        setError("");

        const importFields: Record<string, unknown> = {};
        if (dsFxReady) {
            importFields.fx_rate = dsFxRateNum;
            importFields.fx_rate_date = dsFxRateDate;
        }
        if (dsCostCop !== null) importFields.supplier_cost_cop = dsCostCop;
        if (dsShipCop !== null) {
            importFields.supplier_shipping_cop = dsShipCop;
            importFields.customer_shipping_cop = dsShipCop;
        }
        if (dsCurrentQuote) {
            importFields.shipping_estimate_city = dsCurrentQuote.destination;
            importFields.shipping_checked_at = dsCurrentQuote.checkedAt;
        }
        const priceCop = Number.isSafeInteger(dsPriceNum) && dsPriceNum > 0 ? dsPriceNum : null;
        if (priceCop !== null) importFields.price_cop = priceCop;

        try {
            const res = await fetch("/api/admin/catalog", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    source: "aliexpress_ds",
                    providerItemId: chosen ? `${dsProduct.productId}-${chosen.skuId}` : dsProduct.productId,
                    sourceUrl: dsProduct.sourceUrl,
                    title: dsProduct.title,
                    images: dsProduct.images,
                    listingPrice: chosen?.offerSalePrice ?? chosen?.skuPrice ?? null,
                    listingCurrency: chosen?.currency ?? dsProduct.currency,
                    fields: Object.keys(importFields).length > 0 ? importFields : undefined,
                    supplierVariant: chosen
                        ? {
                              product_id: dsProduct.productId,
                              sku_id: chosen.skuId,
                              sku_attr: chosen.skuAttr,
                              offer_sale_price: chosen.offerSalePrice,
                              sku_price: chosen.skuPrice,
                              sku_available_stock: chosen.availableStock,
                              currency_code: chosen.currency,
                              delivery_time_days: dsProduct.deliveryTimeDays,
                              provider_reported_sales: dsProduct.providerReportedSales,
                              freight:
                                  dsCurrentQuote && dsSelectedOption
                                      ? {
                                            method: "aliexpress.ds.freight.query",
                                            checked_at: dsCurrentQuote.checkedAt,
                                            destination: dsCurrentQuote.destination,
                                            quantity: dsCurrentQuote.quantity,
                                            option_code: dsSelectedOption.code,
                                            company: dsSelectedOption.company,
                                            min_days: dsSelectedOption.minDays,
                                            max_days: dsSelectedOption.maxDays,
                                            fee_usd: dsSelectedOption.feeUsd,
                                            fee_label: dsSelectedOption.feeLabel,
                                            free_shipping: dsSelectedOption.freeShipping,
                                            ddp_includes_vat_tax: dsSelectedOption.ddpIncludesVatTax,
                                            fx_rate: dsFxReady ? dsFxRateNum : null,
                                            fx_rate_date: dsFxReady ? dsFxRateDate : null,
                                            target_margin_percent: dsMargin,
                                            provisional: dsSuggestion?.provisional ?? null,
                                        }
                                      : null,
                          }
                        : null,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setNotice(
                    body.created
                        ? `Borrador creado: ${dsProduct.title}. Revisa y publica desde la lista de borradores.`
                        : `Este producto ya existe como borrador o publicado (${body.id}).`
                );
                const draftsRes = await fetch("/api/admin/catalog");
                if (draftsRes.ok) setDrafts((await draftsRes.json()).drafts ?? []);
            } else {
                setError(body.error || "No se pudo importar el producto.");
            }
        } catch {
            setError("Error de red al importar.");
        } finally {
            setDsBusy(false);
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
        setPublishError("");
        try {
            const res = await fetch(`/api/admin/catalog/${draft.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "publish", fields: reviewFields(reviewForm) }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setNotice(`"${draft.name}" publicado en el catálogo.`);
                setPublishError("");
                setReviewingId(null);
                setReviewForm(null);
                setDrafts(drafts.filter((d) => d.id !== draft.id));
            } else {
                setPublishError(describePublishError(body));
            }
        } catch {
            setPublishError("Error de red al publicar.");
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
    const dsFeedItems = data?.items.filter((i) => i.source === "aliexpress_ds") ?? [];
    const cjItems = data?.items.filter((i) => i.source === "cjdropshipping") ?? [];
    const dsStatus = data?.sources.find((s) => s.source === "aliexpress_ds");
    const cjStatus = data?.sources.find((s) => s.source === "cjdropshipping");

    const handleDsFeedImport = (item: TrendItem) => {
        setDsProductId(item.sourceId);
        void runDsLookup(item.sourceId);
    };

    const runDsDiagnostics = async () => {
        setDsDiagBusy(true);
        setDsDiag(null);
        setDsDiagCopied(false);
        setError("");
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/diagnostics", {
                method: "POST",
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo ejecutar el diagnóstico.");
                return;
            }
            setDsDiag(JSON.stringify(body.diagnostics, null, 2));
        } catch {
            setError("Error de red al ejecutar el diagnóstico.");
        } finally {
            setDsDiagBusy(false);
        }
    };

    const dsResultMessage = dsConnectResult
        ? ({
              connected: ["AliExpress DS conectado correctamente.", true],
              exchange_failed: ["No se pudo completar la conexión con AliExpress DS.", false],
              persist_failed: ["La conexión DS no se pudo guardar. Intenta de nuevo.", false],
              connection_busy: ["Otra operación DS está en curso. Intenta de nuevo.", false],
          }[dsConnectResult] ?? ["No se pudo conectar AliExpress DS. Vuelve a intentarlo.", false])
        : null;

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
                        <h4 className="font-heading text-base font-bold text-white mb-1">
                            Feed de más vendidos · AliExpress DS (proveedor)
                        </h4>
                        <p className="text-[11px] text-muted mb-4">
                            Orden y contenido reportados por el feed del proveedor; período de ventas no verificado. Consultar un item ejecuta la búsqueda DS para elegir variante, flete y precio.
                        </p>
                        {dsFeedItems.length === 0 ? (
                            <p className="text-xs text-muted">
                                {describeEmptyFeed("aliexpress_ds", dsStatus)}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {dsFeedItems.map((item) => (
                                    <TrendCard key={item.id} item={item} onImport={handleDsFeedImport} importing={dsBusy} actionLabel="Consultar" />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8">
                        <h4 className="font-heading text-base font-bold text-white mb-1">
                            Productos en tendencia · CJ Dropshipping (proveedor)
                        </h4>
                        <p className="text-[11px] text-muted mb-4">
                            Señal de catálogo del proveedor: cantidad de publicaciones listadas. No representa ventas ni demanda verificada. Los precios de lista no son costo mayorista.
                        </p>
                        {cjItems.length === 0 ? (
                            <p className="text-xs text-muted">
                                {describeEmptyFeed("cjdropshipping", cjStatus)}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {cjItems.map((item) => (
                                    <TrendCard key={item.id} item={item} onImport={handleImport} importing={importingId === item.id} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="glass rounded-3xl p-6 md:p-8">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
                            <h4 className="font-heading text-base font-bold text-white">
                                Proveedor · AliExpress Dropshipping
                            </h4>
                            <div className="flex flex-col sm:flex-row gap-2 self-start">
                                <a
                                    href="/api/admin/providers/aliexpress-ds/authorize"
                                    className="px-3 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary text-xs flex items-center gap-2 hover:bg-primary/20 transition-colors"
                                >
                                    <PlugZap className="w-3.5 h-3.5" />
                                    Conectar AliExpress DS
                                </a>
                                <button
                                    type="button"
                                    onClick={() => void runDsDiagnostics()}
                                    disabled={dsDiagBusy}
                                    className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white text-xs flex items-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    {dsDiagBusy ? "Diagnosticando (2 llamadas en vivo)..." : "Diagnosticar AliExpress DS"}
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] text-muted mb-4">
                            Busca un producto por su ID de AliExpress. Las ventas mostradas son reportadas por el proveedor, no una tendencia. Requiere la app DS conectada por OAuth.
                        </p>
                        {dsResultMessage && (
                            <p className={`text-xs mb-3 ${dsResultMessage[1] ? "text-green-300" : "text-red-300"}`}>
                                {dsResultMessage[0]}
                            </p>
                        )}
                        {dsDiag && (
                            <div className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] text-muted">
                                        Diagnóstico sanitizado (2 llamadas de solo lectura; sin pedidos). Comparte este JSON si necesitas ayuda.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void navigator.clipboard
                                                .writeText(dsDiag)
                                                .then(() => setDsDiagCopied(true))
                                                .catch(() => setDsDiagCopied(false));
                                        }}
                                        className="text-[10px] text-primary hover:underline shrink-0"
                                    >
                                        {dsDiagCopied ? "Copiado" : "Copiar resultado"}
                                    </button>
                                </div>
                                <pre className="text-[10px] text-white/80 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                                    {dsDiag}
                                </pre>
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                inputMode="numeric"
                                value={dsProductId}
                                onChange={(e) => setDsProductId(e.target.value)}
                                placeholder="ID de producto (ej. 1005001234567890)"
                                className={inputClass}
                            />
                            <button
                                onClick={handleDsLookup}
                                disabled={dsBusy || !dsProductId.trim()}
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-all disabled:opacity-50 shrink-0"
                            >
                                {dsBusy ? "Consultando..." : "Buscar producto"}
                            </button>
                        </div>
                        {dsProduct && (
                            <div className="mt-4 rounded-2xl border border-white/10 p-4 space-y-3">
                                <div className="flex gap-3 items-start">
                                    {dsProduct.images[0] && isHttpUrl(dsProduct.images[0]) && (
                                        <Image
                                            src={dsProduct.images[0]}
                                            alt={dsProduct.title}
                                            width={64}
                                            height={64}
                                            unoptimized
                                            className="rounded-xl object-cover shrink-0"
                                        />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{dsProduct.title}</p>
                                        <p className="text-[11px] text-muted">
                                            ID {dsProduct.productId}
                                            {dsProduct.currency ? ` · ${dsProduct.currency}` : ""}
                                            {dsProduct.providerReportedSales != null &&
                                                ` · ${dsProduct.providerReportedSales} ventas reportadas por el proveedor`}
                                            {dsProduct.deliveryTimeDays != null &&
                                                ` · entrega aprox. ${dsProduct.deliveryTimeDays} días`}
                                        </p>
                                    </div>
                                </div>
                                {dsProduct.skus.length > 1 ? (
                                    <select
                                        value={dsSkuId}
                                        onChange={(e) => {
                                            setDsSkuId(e.target.value);
                                            setDsPrice("");
                                            setDsPriceDirty(false);
                                        }}
                                        className={inputClass}
                                    >
                                        <option value="">Selecciona variante (SKU)...</option>
                                        {dsProduct.skus.map((sku) => (
                                            <option
                                                key={sku.skuId}
                                                value={sku.skuId}
                                                disabled={sku.availableStock === 0}
                                            >
                                                {sku.skuAttr || sku.skuId}
                                                {sku.offerSalePrice != null || sku.skuPrice != null
                                                    ? ` · ${sku.offerSalePrice ?? sku.skuPrice} ${sku.currency ?? ""}`
                                                    : ""}
                                                {sku.availableStock != null ? ` · stock ${sku.availableStock}` : ""}
                                                {sku.availableStock === 0 ? " · agotado" : ""}
                                            </option>
                                        ))}
                                    </select>
                                ) : dsProduct.skus.length === 1 ? (
                                    <p className="text-[11px] text-muted">
                                        Variante: {dsProduct.skus[0].skuAttr || dsProduct.skus[0].skuId}
                                        {dsProduct.skus[0].availableStock != null &&
                                            ` · stock ${dsProduct.skus[0].availableStock}`}
                                        {dsProduct.skus[0].availableStock === 0 && " · agotado"}
                                    </p>
                                ) : null}

                                {dsSelectedSku && (
                                    <div className="rounded-xl border border-white/10 p-3 space-y-2">
                                        <p className="text-[11px] font-semibold text-white">
                                            Flete al cliente · cotización indicativa por unidad a {dsCurrentQuote?.destination ?? "Bogotá"}
                                        </p>
                                        {dsFreightLoading ? (
                                            <p className="text-[11px] text-muted animate-pulse">Consultando opciones de envío...</p>
                                        ) : dsFreightError ? (
                                            <div className="flex items-center gap-2">
                                                <p role="alert" className="text-[11px] text-red-300">{dsFreightError}</p>
                                                <button
                                                    type="button"
                                                    onClick={() => void loadDsFreight(dsProduct.productId, dsSelectedSku.skuId)}
                                                    className="text-[11px] text-primary hover:underline shrink-0"
                                                >
                                                    Reintentar
                                                </button>
                                            </div>
                                        ) : dsCurrentQuote && dsCurrentQuote.options.length === 0 ? (
                                            <p className="text-[11px] text-amber-300">
                                                El proveedor no devolvió opciones de envío. El envío quedará pendiente en el borrador.
                                            </p>
                                        ) : dsCurrentQuote ? (
                                            <div className="space-y-1.5">
                                                {dsCurrentQuote.options.map((option, idx) => {
                                                    const optionOutOfStock = option.availableStock === 0;
                                                    return (
                                                        <label
                                                            key={`${option.code ?? idx}`}
                                                            className={`flex items-start gap-2 p-2 rounded-lg border text-[11px] transition-colors ${
                                                                dsFreightIdx === idx
                                                                    ? "border-primary/50 bg-primary/10"
                                                                    : "border-white/10 hover:border-white/20"
                                                            } ${optionOutOfStock ? "opacity-50" : "cursor-pointer"}`}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name="ds-freight"
                                                                checked={dsFreightIdx === idx}
                                                                disabled={optionOutOfStock}
                                                                onChange={() => setDsFreightIdx(idx)}
                                                                className="mt-0.5 accent-primary"
                                                            />
                                                            <span className="min-w-0">
                                                                <span className="text-white font-medium block">
                                                                    {option.company || option.code || "Opción de envío"}
                                                                </span>
                                                                <span className="text-muted">
                                                                    {option.feeUsd !== null
                                                                        ? option.feeUsd === 0
                                                                            ? "Envío gratis del proveedor"
                                                                            : `${option.feeLabel ?? `US $${option.feeUsd}`}`
                                                                        : "Tarifa no disponible"}
                                                                    {option.minDays != null && option.maxDays != null &&
                                                                        ` · ${option.minDays}–${option.maxDays} días`}
                                                                    {option.availableStock != null &&
                                                                        ` · stock ${option.availableStock}`}
                                                                    {optionOutOfStock && " · agotado"}
                                                                    {option.ddpIncludesVatTax && " · impuestos incluidos según proveedor"}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                {dsSelectedSku && (
                                    <div className="rounded-xl border border-white/10 p-3 space-y-2">
                                        <p className="text-[11px] font-semibold text-white">Costos y precio</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] text-muted block mb-1">Tasa USD→COP *</label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step="0.01"
                                                    value={dsFxRate}
                                                    onChange={(e) => setDsFxRate(e.target.value)}
                                                    placeholder="Ej: 4200"
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-muted block mb-1">Fecha de la tasa *</label>
                                                <input
                                                    type="date"
                                                    value={dsFxRateDate}
                                                    onChange={(e) => setDsFxRateDate(e.target.value)}
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        {!dsFxReady && (
                                            <p className="text-[10px] text-amber-300">
                                                Ingresa una tasa USD→COP manual y su fecha para calcular costos en pesos. No hay proveedor de tasa automático.
                                            </p>
                                        )}
                                        {dsFxReady && (
                                            <p className="text-[10px] text-muted">
                                                {dsSupplierUsd !== null && dsCostCop !== null
                                                    ? `Costo proveedor: ${dsSupplierUsd} USD → ${formatCOP(dsCostCop)}`
                                                    : !dsSkuInStock
                                                      ? "Variante agotada: sin sugerencia de costo."
                                                      : "La variante no reporta precio en USD; no se convierte como dólar."}
                                                {dsSelectedOption &&
                                                    (dsSelectedOption.feeUsd !== null && dsShipCop !== null
                                                        ? ` · Flete: ${dsSelectedOption.feeUsd} USD → ${formatCOP(dsShipCop)}`
                                                        : " · Flete sin tarifa disponible")}
                                            </p>
                                        )}
                                        <div>
                                            <label className="text-[10px] text-muted block mb-1">
                                                Margen de contribución objetivo: {dsMargin}%
                                            </label>
                                            <input
                                                type="range"
                                                min={15}
                                                max={50}
                                                step={1}
                                                value={dsMargin}
                                                onChange={(e) => {
                                                    const v = Number(e.target.value);
                                                    setDsMargin(v);
                                                    setDsPriceDirty(false);
                                                    applyDsSuggestion(v);
                                                }}
                                                className="w-full accent-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-muted block mb-1">
                                                Precio de venta del producto COP (envío se cobra aparte)
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                value={dsPrice}
                                                onChange={(e) => {
                                                    setDsPrice(e.target.value);
                                                    setDsPriceDirty(true);
                                                }}
                                                placeholder="Edita o mueve el slider para sugerir"
                                                className={inputClass}
                                            />
                                        </div>
                                        {dsSuggestion !== null && (
                                            <p className="text-[10px] text-muted">
                                                Sugerencia a {dsMargin}%: producto {formatCOP(dsSuggestion.customerProduct)} + envío {formatCOP(dsSuggestion.customerShipping)} = {formatCOP(dsSuggestion.total)} · contribución {formatCOP(dsSuggestion.contributionCop)}.
                                                {dsSuggestion.provisional &&
                                                    " Provisional: impuestos y comisión de pasarela desconocidos no incluidos."}
                                            </p>
                                        )}
                                        {dsActualContribution !== null && (
                                            <p className={`text-[10px] font-mono ${dsActualContribution >= 0 ? "text-green-400" : "text-red-400"}`}>
                                                Contribución estimada al precio ingresado: {formatCOP(dsActualContribution)} (producto − costo proveedor; envío se cobra aparte; sin impuestos ni comisiones; no garantiza utilidad).
                                            </p>
                                        )}
                                    </div>
                                )}

                                <button
                                    onClick={handleDsImport}
                                    disabled={dsBusy || (dsProduct.skus.length > 1 && !dsSkuId)}
                                    className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-semibold transition-all disabled:opacity-50"
                                >
                                    {dsBusy ? "Importando..." : "Importar como borrador"}
                                </button>
                                {dsSelectedSku && dsShipCop === null && (
                                    <p className="text-[10px] text-amber-300">
                                        Sin tarifa de flete válida el producto se importará con envío pendiente, no gratis.
                                    </p>
                                )}
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
                                                            setPublishError("");
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
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <button
                                                            onClick={() => handlePublish(draft)}
                                                            disabled={submitting}
                                                            className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                                                        >
                                                            {submitting ? "Publicando..." : "Publicar al catálogo"}
                                                        </button>
                                                        {publishError && (
                                                            <p role="alert" className="text-xs text-red-300">
                                                                {publishError}
                                                            </p>
                                                        )}
                                                    </div>
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
    actionLabel = "Importar",
}: {
    item: TrendItem;
    onImport: (item: TrendItem) => void;
    importing: boolean;
    actionLabel?: string;
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
                        {item.listingCount != null && (
                            <span>· {item.listingCount} listados</span>
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
                    {importing ? "Procesando..." : actionLabel}
                </button>
            </div>
        </div>
    );
}
