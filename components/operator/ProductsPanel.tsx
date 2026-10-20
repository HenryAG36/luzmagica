"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, PackageSearch } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import type { CatalogRow } from "@/lib/catalog/validate";
import { isHttpUrl, validatePublishable } from "@/lib/catalog/validate";
import { describePublishError } from "@/lib/catalog/publishFeedback";
import { usdToCop } from "@/lib/catalog/pricing";
import PricingControls from "@/components/operator/PricingControls";

const SOURCE_LABELS: Record<string, string> = {
    manual: "Manual",
    mercadolibre: "Mercado Libre",
    aliexpress: "AliExpress (solo investigación)",
    aliexpress_ds: "AliExpress DS (solo investigación)",
    cjdropshipping: "CJ Dropshipping (solo investigación)",
    mastershop: "Mastershop",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
    draft: { label: "Borrador", className: "bg-amber-500/15 text-warning border-warning/30" },
    published: { label: "Publicado", className: "bg-green-500/15 text-success border-success/30" },
    archived: { label: "Retirado", className: "bg-black/5 text-muted border-black/10" },
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
    mastershopWeight: string;
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
        mastershopWeight:
            row.source === "mastershop" &&
            typeof row.supplier_variant?.mastershop_weight === "number"
                ? String(row.supplier_variant.mastershop_weight)
                : "",
        supplierRightsConfirmed: row.supplier_rights_confirmed === true,
    };
}

function formFields(
    form: ManageForm,
    row: CatalogRow
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
    const base: Record<string, unknown> = {
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
    // Mastershop weight is required for COD submission; it lives inside the
    // supplier_variant snapshot so the other ids survive the save.
    if (row.source === "mastershop") {
        const variant = { ...(row.supplier_variant ?? {}) };
        const raw = form.mastershopWeight.trim();
        if (raw === "") {
            delete variant.mastershop_weight;
        } else {
            const weight = Number(raw);
            if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000) {
                return { ok: false, error: "El peso para Mastershop debe ser un número positivo." };
            }
            variant.mastershop_weight = weight;
        }
        base.supplier_variant = variant;
    }
    return { ok: true, fields: base };
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
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-black/10 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary";

// Only local-supplier rows can sync against a live supplier; AliExpress/CJ
// are research/historical under the sourcing policy.
const SUPPLIER_SOURCES = new Set(["mastershop"]);
const RESEARCH_SOURCES = new Set(["aliexpress", "aliexpress_ds", "cjdropshipping"]);

const MISSING_LABELS: Record<string, string> = {
    name: "título", category: "categoría", room: "habitación", type: "tipo",
    description: "descripción", images: "imágenes", price_cop: "precio",
    stock: "stock", supplier_rights_confirmed: "derechos",
    customer_shipping_cop: "envío cliente", shipping_estimate_city: "ciudad envío",
    shipping_checked_at: "fecha cotización",
    research_only_source: "fuente solo de investigación (sin importación)",
};

function publishReadiness(row: CatalogRow): { ready: boolean; missing: string[] } {
    const result = validatePublishable(row, { allowSoldOut: row.status === "published" });
    return { ready: result.valid, missing: result.missing };
}

export default function ProductsPanel({ draftOnly = false }: { draftOnly?: boolean }) {
    const [products, setProducts] = useState<CatalogRow[]>([]);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");
    const [readinessFilter, setReadinessFilter] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<ManageForm | null>(null);
    const [formError, setFormError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

    const load = useCallback(async (nextOffset: number) => {
        setLoading(true);
        setError("");
        try {
            if (draftOnly) {
                const res = await fetch("/api/admin/catalog");
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(body.error || "No se pudieron cargar los borradores.");
                    return;
                }
                setProducts(Array.isArray(body.drafts) ? body.drafts : []);
                setOffset(0);
                return;
            }
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
    }, [draftOnly]);

    useEffect(() => {
        void load(0);
    }, [load]);

    const patch = async (row: CatalogRow, action: string, fields?: Record<string, unknown>) => {
        if (syncingId !== null) return false;
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
        const fields = formFields(editForm, row);
        if (!fields.ok) {
            setFormError(fields.error);
            return;
        }
        if (await patch(row, "update", fields.fields)) {
            setNotice(`"${row.name}" guardado.`);
            setEditingId(null);
            setEditForm(null);
            void load(offset);
        }
    };

    const handlePublish = async (row: CatalogRow) => {
        if (!editForm) return;
        const fields = formFields(editForm, row);
        if (!fields.ok) {
            setFormError(fields.error);
            return;
        }
        if (await patch(row, "publish", fields.fields)) {
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

    const handleSupplierSync = async (row: CatalogRow) => {
        if (submitting || syncingId !== null || editingId !== null) return;
        setSyncingId(row.id);
        setFormError("");
        setNotice("");
        setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
        try {
            const res = await fetch(`/api/admin/catalog/${row.id}/supplier-sync`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedUpdatedAt: row.updated_at }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setRowErrors((prev) => ({
                    ...prev,
                    [row.id]: body.error || `No se pudo sincronizar (HTTP ${res.status}).`,
                }));
                return;
            }
            const warns = Array.isArray(body.warnings) && body.warnings.length
                ? ` Avisos: ${body.warnings.join(" ")}`
                : "";
            setNotice(`Costo y stock de "${row.name}" actualizados desde el proveedor.${warns}`);
            void load(offset);
        } catch {
            setRowErrors((prev) => ({ ...prev, [row.id]: "Error de red al sincronizar." }));
        } finally {
            setSyncingId(null);
        }
    };

    const handleDelete = async (row: CatalogRow) => {
        if (syncingId !== null) return;
        setDeleteConfirmId(null);
        setSubmitting(true);
        setFormError("");
        setError("");
        setNotice("");
        try {
            const res = await fetch(`/api/admin/catalog/${row.id}`, { method: "DELETE" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo eliminar el producto.");
                return;
            }
            setNotice(`"${row.name}" eliminado permanentemente.`);
            void load(offset);
        } catch {
            setError("Error de red al eliminar.");
        } finally {
            setSubmitting(false);
        }
    };

    const query = search.trim().toLowerCase();
    const sourceOptions = [...new Set(products.map((p) => p.source))].sort();
    const filtered = products.filter((p) => {
        if (statusFilter && p.status !== statusFilter) return false;
        if (sourceFilter && p.source !== sourceFilter) return false;
        if (readinessFilter === "ready" && !publishReadiness(p).ready) return false;
        if (readinessFilter === "incomplete" && publishReadiness(p).ready) return false;
        if (!query) return true;
        return (
            p.name.toLowerCase().includes(query) ||
            p.id.toLowerCase().includes(query) ||
            (SOURCE_LABELS[p.source] ?? p.source).toLowerCase().includes(query)
        );
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
                        <PackageSearch className="w-5 h-5 text-accent-dark" />
                        {draftOnly ? "Borradores de importación" : "Productos del catálogo"}
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        {draftOnly
                            ? "Borradores importados de proveedores. Revisa costos, derechos y envío antes de publicar."
                            : "Gestiona borradores, productos publicados y retirados. Los cambios en productos publicados se validan como si se republicaran."}
                    </p>
                </div>
            </div>

            {error && (
                <div className="p-3.5 rounded-2xl bg-red-500/15 border border-danger/30 text-danger text-xs flex items-center gap-2.5">
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

            <div className="glass rounded-3xl p-6 md:p-8 space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, id o fuente (solo esta página)..."
                        className={inputClass}
                    />
                    {!draftOnly && (
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className={`${inputClass} sm:w-40`}
                            aria-label="Filtrar por estado"
                        >
                            <option value="">Todos los estados</option>
                            <option value="draft">Borrador</option>
                            <option value="published">Publicado</option>
                            <option value="archived">Retirado</option>
                        </select>
                    )}
                    <select
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                        className={`${inputClass} sm:w-44`}
                        aria-label="Filtrar por fuente"
                    >
                        <option value="">Todas las fuentes</option>
                        {sourceOptions.map((s) => (
                            <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
                        ))}
                    </select>
                    <select
                        value={readinessFilter}
                        onChange={(e) => setReadinessFilter(e.target.value)}
                        className={`${inputClass} sm:w-44`}
                        aria-label="Filtrar por estado de publicación"
                    >
                        <option value="">Cualquier estado</option>
                        <option value="ready">Listo para publicar</option>
                        <option value="incomplete">Datos incompletos</option>
                    </select>
                    {!draftOnly && (
                    <div className="flex gap-2 shrink-0">
                        <button
                            type="button"
                            disabled={loading || offset === 0}
                            onClick={() => void load(Math.max(0, offset - PAGE))}
                            className="px-3 py-2 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs hover:bg-black/5 disabled:opacity-40"
                        >
                            Anterior
                        </button>
                        <button
                            type="button"
                            disabled={loading || products.length < PAGE}
                            onClick={() => void load(offset + PAGE)}
                            className="px-3 py-2 rounded-xl border border-black/10 bg-black/5 text-foreground text-xs hover:bg-black/5 disabled:opacity-40"
                        >
                            Siguiente
                        </button>
                    </div>
                    )}
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
                            const readiness = publishReadiness(row);
                            const isSupplier =
                                (row.status === "draft" || row.status === "published") &&
                                SUPPLIER_SOURCES.has(row.source) &&
                                typeof row.supplier_variant?.product_id === "string" &&
                                typeof row.supplier_variant?.variation_id === "string";
                            const isResearch = RESEARCH_SOURCES.has(row.source);
                            const fetchedAt =
                                row.supplier_variant && typeof row.supplier_variant.fetched_at === "string"
                                    ? row.supplier_variant.fetched_at
                                    : null;
                            return (
                                <div
                                    key={row.id}
                                    className="p-4 rounded-2xl bg-surface-card border border-black/10"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-semibold text-foreground truncate">
                                                    {row.name}
                                                </span>
                                                <span
                                                    className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${badge.className}`}
                                                >
                                                    {badge.label}
                                                </span>
                                                {isResearch && row.status !== "archived" && (
                                                    <span className="px-2 py-0.5 rounded-full border border-black/10 bg-black/5 text-muted text-[10px] font-semibold">
                                                        Solo investigación — no publicable
                                                    </span>
                                                )}
                                                {!isResearch && (row.status === "draft" || row.status === "published") && (
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                                                            readiness.ready
                                                                ? "bg-green-500/15 text-success border-success/30"
                                                                : "bg-amber-500/15 text-warning border-warning/30"
                                                        }`}
                                                        title={
                                                            readiness.ready
                                                                ? "Listo para publicar"
                                                                : `Falta: ${readiness.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}`
                                                        }
                                                    >
                                                        {readiness.ready
                                                            ? "Listo"
                                                            : `Falta: ${readiness.missing.slice(0, 2).map((m) => MISSING_LABELS[m] ?? m).join(", ")}${readiness.missing.length > 2 ? ` +${readiness.missing.length - 2}` : ""}`}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-muted mt-0.5">
                                                {SOURCE_LABELS[row.source] ?? row.source} · {row.id}
                                                {" · "}
                                                {formatCOP(row.price_cop)} · stock {row.stock} ·{" "}
                                                {row.customer_shipping_cop !== null
                                                    ? `envío ${formatCOP(row.customer_shipping_cop)}${row.shipping_estimate_city ? ` (${row.shipping_estimate_city})` : ""}`
                                                    : "envío pendiente"}
                                            </div>
                                            {fetchedAt && (
                                                <div className="text-[10px] text-muted mt-0.5">
                                                    Proveedor consultado: {new Date(fetchedAt).toLocaleString("es-CO")}
                                                </div>
                                            )}
                                            {row.source_url && isHttpUrl(row.source_url) && (
                                                <a
                                                    href={row.source_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[11px] text-accent-dark hover:underline flex items-center gap-1 mt-0.5"
                                                >
                                                    Ver en origen <ExternalLink className="w-3 h-3" />
                                                </a>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 shrink-0">
                                            {isSupplier && (
                                                <button
                                                    type="button"
                                                    title="Re-consulta stock y costo al proveedor; no cambia texto, imágenes ni precio de venta."
                                                    onClick={() => void handleSupplierSync(row)}
                                                    disabled={submitting || syncingId !== null || editingId !== null}
                                                    className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-primary/15 text-muted hover:text-accent-dark text-xs font-semibold transition-colors disabled:opacity-50"
                                                >
                                                    {syncingId === row.id ? "Sincronizando..." : "Actualizar costo y stock"}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFormError("");
                                                    setEditingId(isEditing ? null : row.id);
                                                    setEditForm(isEditing ? null : seedForm(row));
                                                }}
                                                disabled={syncingId !== null}
                                                className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-accent-dark text-xs font-semibold transition-colors disabled:opacity-50"
                                            >
                                                {isEditing ? "Cerrar" : "Editar"}
                                            </button>
                                            {row.status === "draft" && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setDeleteConfirmId(null);
                                                            setArchiveConfirmId(row.id);
                                                        }}
                                                        disabled={submitting || syncingId !== null}
                                                        className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-warning/10 text-muted hover:text-warning text-xs transition-colors disabled:opacity-50"
                                                    >
                                                        Retirar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setArchiveConfirmId(null);
                                                            setDeleteConfirmId(row.id);
                                                        }}
                                                        disabled={submitting || syncingId !== null}
                                                        className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-danger/10 text-muted hover:text-danger text-xs transition-colors disabled:opacity-50"
                                                    >
                                                        Descartar borrador
                                                    </button>
                                                </>
                                            )}
                                            {row.status === "published" && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDeleteConfirmId(null);
                                                        setArchiveConfirmId(row.id);
                                                    }}
                                                    disabled={submitting || syncingId !== null}
                                                    className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-warning/10 text-muted hover:text-warning text-xs transition-colors disabled:opacity-50"
                                                >
                                                    Retirar del catálogo
                                                </button>
                                            )}
                                            {row.status === "archived" && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setArchiveConfirmId(null);
                                                        setDeleteConfirmId(row.id);
                                                    }}
                                                    disabled={submitting || syncingId !== null}
                                                    className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-danger/10 text-muted hover:text-danger text-xs transition-colors disabled:opacity-50"
                                                >
                                                    Eliminar
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {rowErrors[row.id] && (
                                        <p role="alert" className="mt-2 text-xs text-danger">
                                            {rowErrors[row.id]}
                                        </p>
                                    )}

                                    {archiveConfirmId === row.id && (
                                        <div className="mt-3 p-3 rounded-xl border border-warning/30 bg-warning/10 flex flex-col sm:flex-row sm:items-center gap-2">
                                            <p className="text-[11px] text-warning flex-1">
                                                ¿Retirar &quot;{row.name}&quot;? Se oculta de la tienda sin
                                                borrar el registro; puede republicarse después.
                                            </p>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleArchive(row)}
                                                    disabled={submitting || syncingId !== null}
                                                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                                                >
                                                    Confirmar retiro
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setArchiveConfirmId(null)}
                                                    className="px-3 py-1.5 rounded-xl bg-black/5 text-muted text-xs hover:bg-black/5"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {deleteConfirmId === row.id && (
                                        <div className="mt-3 p-3 rounded-xl border border-danger/30 bg-danger/10 flex flex-col sm:flex-row sm:items-center gap-2">
                                            <p className="text-[11px] text-danger flex-1">
                                                {row.status === "draft"
                                                    ? `¿Descartar el borrador "${row.name}"? Se elimina el borrador sin publicar; no se puede deshacer.`
                                                    : `¿Eliminar "${row.name}" permanentemente? Borra el registro y sus reseñas; no se puede deshacer. El historial de pedidos no se afecta.`}
                                            </p>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDelete(row)}
                                                    disabled={submitting || syncingId !== null}
                                                    className="px-3 py-1.5 rounded-xl bg-danger hover:bg-danger/90 text-white text-xs font-semibold disabled:opacity-50"
                                                >
                                                    {row.status === "draft" ? "Confirmar descarte" : "Confirmar eliminación"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteConfirmId(null)}
                                                    className="px-3 py-1.5 rounded-xl bg-black/5 text-muted text-xs hover:bg-black/5"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {isEditing && editForm && (
                                        <div className="mt-4 pt-4 border-t border-black/10 space-y-3">
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
                                            {row.source === "mastershop" && (
                                                <div>
                                                    <label className="text-[11px] text-muted block mb-1">
                                                        Peso para Mastershop (contraentrega)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step="any"
                                                        value={editForm.mastershopWeight}
                                                        onChange={(e) => setEditForm({ ...editForm, mastershopWeight: e.target.value })}
                                                        className={inputClass}
                                                        placeholder="Ej: 0.5"
                                                    />
                                                    <p className="text-[10px] text-muted mt-1">
                                                        Copia el peso y la unidad usados en la ficha de
                                                        Mastershop; no es un costo ni un peso estimado. Usa el
                                                        valor de peso que Mastershop espera en su API; confirma
                                                        la unidad con el proveedor. Sin este dato el producto no
                                                        puede venderse contraentrega.
                                                    </p>
                                                </div>
                                            )}
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
                                                    disabled={submitting || syncingId !== null}
                                                    className="px-4 py-2.5 rounded-xl border border-black/10 bg-black/5 hover:bg-black/5 text-foreground text-xs font-semibold transition-colors disabled:opacity-50"
                                                >
                                                    {submitting ? "Guardando..." : "Guardar cambios"}
                                                </button>
                                                {(row.status === "draft" || row.status === "archived") && !isResearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handlePublish(row)}
                                                        disabled={submitting || syncingId !== null}
                                                        className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        {submitting ? "Publicando..." : row.status === "archived" ? "Republicar" : "Publicar al catálogo"}
                                                    </button>
                                                )}
                                                {isResearch && (
                                                    <p className="text-[10px] text-muted">
                                                        Fuente de solo investigación: no se puede publicar ni sincronizar. Puedes retirarla o eliminarla.
                                                    </p>
                                                )}
                                                {formError && (
                                                    <p role="alert" className="text-xs text-danger">
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
