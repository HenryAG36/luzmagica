import type { Product } from "../types";

export interface CatalogRow {
    id: string;
    source: string;
    provider_item_id: string | null;
    source_url: string | null;
    name: string;
    price_cop: number;
    original_price_cop: number | null;
    category: string;
    room: string;
    images: string[] | null;
    badge: string | null;
    description: string;
    stock: number;
    type: string;
    listing_price: number | null;
    listing_currency: string | null;
    supplier_cost_cop: number | null;
    supplier_shipping_cop: number | null;
    taxes_fees_cop: number | null;
    fx_rate: number | null;
    fx_rate_date: string | null;
    supplier_rights_confirmed: boolean;
    supplier_variant: Record<string, unknown> | null;
    status: string;
    reviewed_by: string | null;
    published_at: string | null;
    updated_at: string;
    created_at: string;
}

export interface PublicProductRow {
    id: string;
    name: string;
    price_cop: number;
    original_price_cop: number | null;
    category: string;
    room: string;
    images: string[] | null;
    badge: string | null;
    description: string;
    stock: number;
    type: string;
}

export function toPublicProduct(row: PublicProductRow): Product {
    return {
        id: row.id,
        name: row.name,
        price: row.price_cop,
        originalPrice: row.original_price_cop,
        category: row.category,
        room: row.room,
        images: row.images ?? [],
        badge: row.badge === "sale" || row.badge === "new" ? row.badge : null,
        description: row.description,
        stock: row.stock,
        type: row.type,
    };
}

const MAX_NAME = 200;
const MAX_TEXT = 4000;
const MAX_SLUG = 80;
const MAX_IMAGES = 10;
const PROVIDER_ITEM_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHttpUrl(value: unknown): boolean {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

export function isValidProviderItemId(value: unknown): value is string {
    return typeof value === "string" && PROVIDER_ITEM_ID_PATTERN.test(value);
}

function boundedString(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > max) return null;
    return trimmed;
}

function nonNegativeInt(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
    return value;
}

export function sanitizeImageList(value: unknown): string[] | null {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length > MAX_IMAGES) return null;
    const out: string[] = [];
    for (const item of value) {
        if (!isHttpUrl(item)) return null;
        out.push(item as string);
    }
    return out;
}

export function buildDraftId(source: string, providerItemId: string): string {
    return `imp-${source}-${providerItemId}`;
}

export interface DraftInsert {
    id: string;
    source: string;
    provider_item_id: string;
    source_url: string | null;
    name: string;
    images: string[];
    listing_price: number | null;
    listing_currency: string | null;
    stock: number;
    status: "draft";
    price_cop: number;
    category: string;
    description: string;
    type: string;
    supplier_variant: Record<string, unknown> | null;
    created_by: string;
}

const MAX_VARIANT_BYTES = 8000;

export function sanitizeSupplierVariant(value: unknown): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    if (!isPlainObject(value)) return null;
    try {
        if (JSON.stringify(value).length > MAX_VARIANT_BYTES) return null;
    } catch {
        return null;
    }
    return value;
}

export function buildDraftInsert(input: {
    source: string;
    providerItemId: string;
    sourceUrl?: string | null;
    title: string;
    images?: string[];
    listingPrice?: number | null;
    listingCurrency?: string | null;
    category?: string | null;
    supplierVariant?: Record<string, unknown> | null;
    createdBy: string;
}): DraftInsert {
    return {
        id: buildDraftId(input.source, input.providerItemId),
        source: input.source,
        provider_item_id: input.providerItemId,
        source_url: input.sourceUrl && isHttpUrl(input.sourceUrl) ? input.sourceUrl : null,
        name: input.title.slice(0, MAX_NAME),
        images: input.images ?? [],
        listing_price: typeof input.listingPrice === "number" && Number.isFinite(input.listingPrice) && input.listingPrice >= 0 ? input.listingPrice : null,
        listing_currency: typeof input.listingCurrency === "string" ? input.listingCurrency.slice(0, 8) : null,
        stock: 0,
        status: "draft",
        price_cop: 0,
        category: typeof input.category === "string" ? input.category.slice(0, MAX_SLUG) : "",
        description: "",
        type: "",
        supplier_variant: sanitizeSupplierVariant(input.supplierVariant ?? null),
        created_by: input.createdBy,
    };
}

export const REVIEW_FIELD_VALIDATORS: Record<string, (v: unknown) => unknown | null> = {
    name: (v) => boundedString(v, MAX_NAME),
    category: (v) => boundedString(v, MAX_SLUG),
    room: (v) => boundedString(v, MAX_SLUG),
    type: (v) => boundedString(v, MAX_SLUG),
    description: (v) => boundedString(v, MAX_TEXT),
    badge: (v) => (v === "sale" || v === "new" || v === null ? v : null),
    images: (v) => sanitizeImageList(v),
    price_cop: (v) => nonNegativeInt(v),
    original_price_cop: (v) => (v === null ? null : nonNegativeInt(v)),
    stock: (v) => nonNegativeInt(v),
    supplier_cost_cop: (v) => (v === null ? null : nonNegativeInt(v)),
    supplier_shipping_cop: (v) => (v === null ? null : nonNegativeInt(v)),
    taxes_fees_cop: (v) => (v === null ? null : nonNegativeInt(v)),
    fx_rate: (v) => (v === null ? null : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null),
    fx_rate_date: (v) => (v === null ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
    supplier_rights_confirmed: (v) => (v === true ? true : v === false ? false : null),
    supplier_variant: (v) => sanitizeSupplierVariant(v),
};

export function sanitizeReviewFields(body: unknown): { fields: Record<string, unknown>; errors: string[] } {
    const fields: Record<string, unknown> = {};
    const errors: string[] = [];
    if (!isPlainObject(body)) {
        return { fields, errors: ["fields must be an object"] };
    }
    for (const [key, value] of Object.entries(body)) {
        const validator = REVIEW_FIELD_VALIDATORS[key];
        if (!validator) {
            errors.push(`unknown field: ${key}`);
            continue;
        }
        const sanitized = validator(value);
        if (sanitized === null && value !== null) {
            errors.push(`invalid field: ${key}`);
            continue;
        }
        fields[key] = sanitized;
    }
    return { fields, errors };
}

export interface PublishValidationResult {
    valid: boolean;
    missing: string[];
}

export function validatePublishable(draft: {
    name: string;
    category: string;
    description: string;
    images: string[] | null;
    price_cop: number;
    stock: number;
    supplier_rights_confirmed?: boolean;
}): PublishValidationResult {
    const missing: string[] = [];
    if (!draft.name?.trim()) missing.push("name");
    if (!draft.category?.trim()) missing.push("category");
    if (!draft.description?.trim()) missing.push("description");
    if (!draft.images || draft.images.length === 0) missing.push("images");
    if (!(draft.price_cop > 0)) missing.push("price_cop");
    if (!(draft.stock > 0)) missing.push("stock");
    if (draft.supplier_rights_confirmed !== true) missing.push("supplier_rights_confirmed");
    return { valid: missing.length === 0, missing };
}

export function estimateMarginCOP(input: {
    priceCop: number;
    supplierCostCop: number | null;
    shippingCop: number | null;
    taxesFeesCop: number | null;
}): number | null {
    const { priceCop, supplierCostCop, shippingCop, taxesFeesCop } = input;
    if (supplierCostCop == null || shippingCop == null || taxesFeesCop == null) return null;
    return priceCop - supplierCostCop - shippingCop - taxesFeesCop;
}
