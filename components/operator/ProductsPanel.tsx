"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, PackageSearch } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import type { CatalogRow } from "@/lib/catalog/validate";
import { isHttpUrl } from "@/lib/catalog/validate";
import { describePublishError } from "@/lib/catalog/publishFeedback";
import { usdToCop } from "@/lib/catalog/pricing";
import PricingControls from "@/components/operator/PricingControls";

const SOURCE_LABELS: Record<string, string> = {
    manual: "Manual",
    mercadolibre: "Mercado Libre",
    aliexpress: "AliExpress",
    aliexpress_ds: "AliExpress DS",
    cjdropshipping: "CJ Dropshipping",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
    draft: { label: "Borrador", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    published: { label: "Publicado", className: "bg-green-500/15 text-green-300 border-green-500/30" },
    archived: { label: "Retirado", className: "bg-white/10 text-muted border-white/10" },
};

const PAGE = 100;

interface ManageForm {
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
    paymentFeePercent: string;
    customerShippingCop: string;
    shippingCity: string;
    shippingCheckedAt: string;
    fxRate: string;
    fxRateDate: string;
    supplierRightsConfirmed: boolean;
}

function seedForm(row: CatalogRow): ManageForm {
    return {
        name: row.name,
        category: row.category,
        room: row.room,
        type: row.type,
        description: row.description,
        priceCop: row.price_cop ? String(row.price_cop) : "",
        stock: row.stock ? String(row.stock) : "",
        imagesText: (row.images ?? []).join("\n"),
        supplierCostCop: row.supplier_cost_cop !== null ? String(row.supplier_cost_cop) : "",
        shippingCop: row.supplier_shipping_cop !== null ? String(row.supplier_shipping_cop) : "",
        taxesFeesCop: row.taxes_fees_cop !== null ? String(row.taxes_fees_cop) : "",
        paymentFeePercent: "",
        customerShippingCop: row.customer_shipping_cop !== null ? String(row.customer_shipping_cop) : "",
        shippingCity: row.shipping_estimate_city ?? "",
        shippingCheckedAt: row.shipping_checked_at ?? "",
        fxRate: row.fx_rate ? String(row.fx_rate) : "",
        fxRateDate: row.fx_rate_date ?? "",
        supplierRightsConfirmed: row.supplier_rights_confirmed === true,
    };
}

function formFields(form: ManageForm) {
    return {
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
        customer_shipping_cop:
            form.customerShippingCop.trim() === "" ? null : Number(form.customerShippingCop),
        shipping_estimate_city: form.shippingCity,
        shipping_checked_at: form.shippingCheckedAt || null,
        fx_rate: form.fxRate ? Number(form.fxRate) : null,
        fx_rate_date: form.fxRateDate || null,
        supplier_rights_confirmed: form.supplierRightsConfirmed,
    };
}

function listingCostCop(row: CatalogRow, form: ManageForm): number | null {
    if (row.listing_currency !== "USD" || row.listing_price === null) return null;
    const rate = Number(form.fxRate);
    if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(form.fxRateDate)) {
        return null;
    }
    return usdToCop(row.listing_price, rate);
}

const inputClass =
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary";

export default function ProductsPanel() {
    const [products, setProducts] = useState<CatalogRow[]>([]);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<ManageForm | null>(null);
    const [formError, setFormError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

    const load = useCallback(async (nextOffset: number) => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/admin/catalog?scope=all&limit=${PAGE}&offset=${nextOffset}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo cargar el catálogo.");
                return;
            }
            setProducts(Array.isArray(body.products) ? body.products : []);
            setOffset(nextOffset);
        } catch {
            setError("Error de red al cargar el catálogo.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load(0);
    }, [load]);

    const patch = async (row: CatalogRow, action: string, fields?: Record<string, unknown>) => {
        setSubmitting(true);
        setFormError("");
        setNotice("");
        try {
            const res = await fetch(`/api/admin/catalog/${row.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    action,
                    fields: fields ?? {},
                    expectedUpdatedAt: row.updated_at,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setFormError(describePublishError(body));
                return false;
            }
            return true;
        } catch {
            setFormError("Error de red al guardar.");
            return false;
        } finally {
            setSubmitting(false);
        }
    };

    const handleSave = async (row: CatalogRow) => {
        if (!editForm) return;
        if (await patch(row, "update", formFields(editForm))) {
            setNotice(`"${row.name}" guardado.`);
            setEditingId(null);
            setEditForm(null);
            void load(offset);
        }
    };

    const handlePublish = async (row: CatalogRow) => {
        if (!editForm) return;
        if (await patch(row, "publish", formFields(editForm))) {
            setNotice(`"${row.name}" publicado en el catálogo.`);
            setEditingId(null);
            setEditForm(null);
            void load(offset);
        }
    };

    const handleArchive = async (row: CatalogRow) => {
        setArchiveConfirmId(null);
        if (await patch(row, "archive")) {
            setNotice(`"${row.name}" retirado del catálogo. El registro se conserva.`);
            void load(offset);
        }
    };

    const query = search.trim().toLowerCase();
    const filtered = query
        ? products.filter(
              (p) =>
                  p.name.toLowerCase().includes(query) ||
                  p.id.toLowerCase().includes(query) ||
                  (SOURCE_LABELS[p.source] ?? p.source).toLowerCase().includes(query)
          )
        : products;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-white flex items-center gap-2">
                        <PackageSearch className="w-5 h-5 text-accent" />
                        Productos del catálogo
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Gestiona borradores, productos publicados y retirados. Los cambios en productos
                        publicados se validan como si se republicaran.
                    </p>
                </div>
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

            <div className="glass rounded-3xl p-6 md:p-8 space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, id o fuente (solo esta página)..."
                        className={inputClass}
                    />
                    <div className="flex gap-2 shrink-0">
                        <button
                            type="button"
                            disabled={loading || offset === 0}
                            onClick={() => void load(Math.max(0, offset - PAGE))}
                            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white text-xs hover:bg-white/10 disabled:opacity-40"
                        >
                            Anterior
                        </button>
                        <button
                            type="button"
                            disabled={loading || products.length < PAGE}
                            onClick={() => void load(offset + PAGE)}
                            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white text-xs hover:bg-white/10 disabled:opacity-40"
                        >
                            Siguiente
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="py-10 text-center text-muted text-sm animate-pulse">Cargando productos...</p>
                ) : filtered.length === 0 ? (
                    <p className="text-xs text-muted">
                        {products.length === 0
                            ? "No hay productos en esta página."
                            : "Sin coincidencias en la página cargada."}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {filtered.map((row) => {
                            const isEditing = editingId === row.id;
                            const badge = STATUS_BADGES[row.status] ?? STATUS_BADGES.archived;
                            return (
                                <div
                                    key={row.id}
                                    className="p-4 rounded-2xl bg-surface-card border border-white/10"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-white truncate">
                                                    {row.name}
                                                </span>
                                                <span
                                                    className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${badge.className}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-muted mt-0.5">
                                                {SOURCE_LABELS[row.source] ?? row.source} · {row.id}
                                                {" · "}
                                                {formatCOP(row.price_cop)} · stock {row.stock} ·{" "}
                                                {row.customer_shipping_cop !== null
                                                    ? `envío ${formatCOP(row.customer_shipping_cop)}${row.shipping_estimate_city ? ` (${row.shipping_estimate_city})` : ""}`
                                                    : "envío pendiente"}
                                            </div>
                                            {row.source_url && isHttpUrl(row.source_url) && (
                                                <a
                                                    href={row.source_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[11px] text-primary hover:underline flex items-center gap-1 mt-0.5"
                                                >
                                                    Ver en origen <ExternalLink className="w-3 h-3" />
                                                </a>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFormError("");
                                                    setEditingId(isEditing ? null : row.id);
                                                    setEditForm(isEditing ? null : seedForm(row));
                                                }}
                                                className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors"
                                            >
                                                {isEditing ? "Cerrar" : "Editar"}
                                            </button>
                                            {(row.status === "draft" || row.status === "published") && (
                                                <button
                                                    type="button"
                                                    onClick={() => setArchiveConfirmId(row.id)}
                                                    disabled={submitting}
                                                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-amber-500/20 text-muted hover:text-amber-300 text-xs transition-colors disabled:opacity-50"
                                                >
                                                    Retirar del catálogo
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {archiveConfirmId === row.id && (
                                        <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center gap-2">
                                            <p className="text-[11px] text-amber-200 flex-1">
                                                ¿Retirar &quot;{row.name}&quot;? Se oculta de la tienda sin
                                                borrar el registro; puede republicarse después.
                                            </p>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleArchive(row)}
                                                    disabled={submitting}
                                                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                                                >
                                                    Confirmar retiro
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setArchiveConfirmId(null)}
                                                    className="px-3 py-1.5 rounded-xl bg-white/5 text-muted text-xs hover:bg-white/10"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {isEditing && editForm && (
                                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Título *</label>
                                                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Categoría *</label>
                                                    <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Habitación</label>
                                                    <input value={editForm.room} onChange={(e) => setEditForm({ ...editForm, room: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Tipo</label>
                                                    <input value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Precio de venta COP *</label>
                                                    <input type="number" min={0} value={editForm.priceCop} onChange={(e) => setEditForm({ ...editForm, priceCop: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Stock *</label>
                                                    <input type="number" min={0} value={editForm.stock} onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Tasa USD→COP (opcional)</label>
                                                    <input type="number" min={0} step="0.01" value={editForm.fxRate} onChange={(e) => setEditForm({ ...editForm, fxRate: e.target.value })} className={inputClass} />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">Fecha de la tasa</label>
                                                    <input type="date" value={editForm.fxRateDate} onChange={(e) => setEditForm({ ...editForm, fxRateDate: e.target.value })} className={inputClass} />
                                                </div>
                                            </div>
                                            <PricingControls
                                                key={row.id}
                                                value={editForm}
                                                onChange={(p) => setEditForm({ ...editForm, ...p })}
                                                listingPrice={row.listing_price}
                                                listingCurrency={row.listing_currency}
                                                listingCostCop={listingCostCop(row, editForm)}
                                            />
                                            <div>
                                                <label className="text-[11px] text-muted block mb-1">Imágenes permitidas (URLs http/https, una por línea) *</label>
                                                <textarea
                                                    value={editForm.imagesText}
                                                    onChange={(e) => setEditForm({ ...editForm, imagesText: e.target.value })}
                                                    rows={3}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[11px] text-muted block mb-1">Descripción *</label>
                                                <textarea
                                                    value={editForm.description}
                                                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                    rows={3}
                                                    className={inputClass}
                                                />
                                            </div>
                                            <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.supplierRightsConfirmed}
                                                    onChange={(e) => setEditForm({ ...editForm, supplierRightsConfirmed: e.target.checked })}
                                                    className="mt-0.5"
                                                />
                                                <span>Confirmo que tengo derecho a usar las imágenes y datos del proveedor y que el stock fue verificado. *</span>
                                            </label>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleSave(row)}
                                                    disabled={submitting}
                                                    className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                                                >
                                                    {submitting ? "Guardando..." : "Guardar cambios"}
                                                </button>
                                                {(row.status === "draft" || row.status === "archived") && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handlePublish(row)}
                                                        disabled={submitting}
                                                        className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        {submitting ? "Publicando..." : row.status === "archived" ? "Republicar" : "Publicar al catálogo"}
                                                    </button>
                                                )}
                                                {formError && (
                                                    <p role="alert" className="text-xs text-red-300">
                                                        {formError}
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
        </div>
    );
}
