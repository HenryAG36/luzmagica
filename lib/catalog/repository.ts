import type { Product } from "../types";
import type { SupabaseClientLike } from "../supabase/types";
import type { SupplierPreview } from "./supplierImport.ts";
import { supplierPricing } from "./supplierImport.ts";
import {
    buildDraftInsert,
    toPublicProduct,
    validatePublishable,
} from "./validate.ts";
import type { CatalogRow, PublicProductRow } from "./validate.ts";
import {
    IMPORTABLE_SUPPLIER_SOURCES,
    RESEARCH_ONLY_MESSAGE,
    RESEARCH_ONLY_SOURCES,
} from "../suppliers/policy.ts";
import type { ImportSource } from "./supplierImport.ts";

async function anonClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getAnonServerClient();
}

async function serviceClient(provided?: SupabaseClientLike) {
    if (provided) return provided;
    const mod = await import("@/lib/supabase/server");
    return mod.getServiceRoleClient();
}

export async function attachReviewSummaries(products: Product[], supabase: SupabaseClientLike): Promise<Product[]> {
  if (!products.length) return products;
  const totals = new Map<string, {sum:number;count:number}>();
  const ids = products.map(p => p.id);
  const pageSize = 1000;
  for (let offset=0;;offset+=pageSize) {
    const {data,error} = await supabase.from('product_reviews').select('id,product_id,rating').eq('status','approved').in('product_id',ids).order('id').range(offset,offset+pageSize-1);
    if (error || !data) return products;
    const rows = data as {id:string;product_id:string;rating:number}[];
    for (const row of rows) {
      if (!Number.isInteger(row.rating) || row.rating<1 || row.rating>5) continue;
      const total=totals.get(row.product_id) ?? {sum:0,count:0};
      total.sum+=row.rating;total.count+=1;totals.set(row.product_id,total);
    }
    if (rows.length<pageSize) break;
  }
  return products.map(p=>{const total=totals.get(p.id);return {...p,reviewsCount:total?.count ?? 0,reviewsAvg:total ? total.sum/total.count : undefined};});
}

export async function listPublishedProducts(client?: SupabaseClientLike): Promise<Product[]> {
    const supabase = await anonClient(client);
    if (!supabase) return [];
    const { data, error } = await supabase
        .from("published_products")
        .select("*")
        .order("name");
    if (error || !data) return [];
    const mapped = (data as PublicProductRow[]).map(toPublicProduct);
    return attachReviewSummaries(mapped, supabase);
}

export async function getPublishedProduct(id: string, client?: SupabaseClientLike): Promise<Product | null> {
    const supabase = await anonClient(client);
    if (!supabase) return null;
    const { data } = await supabase
        .from("published_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (!data) return null;
    const [product] = await attachReviewSummaries([toPublicProduct(data as PublicProductRow)], supabase);
    return product ?? null;
}

export async function listPublishedRelated(
    category: string,
    excludeId: string,
    client?: SupabaseClientLike
): Promise<Product[]> {
    const supabase = await anonClient(client);
    if (!supabase) return [];
    const { data } = await supabase
        .from("published_products")
        .select("*")
        .eq("category", category)
        .neq("id", excludeId)
        .limit(4);
    const mapped = ((data as PublicProductRow[] | null) ?? []).map(toPublicProduct);
    return attachReviewSummaries(mapped, supabase);
}

export async function listDrafts(client?: SupabaseClientLike): Promise<CatalogRow[]> {
    const service = await serviceClient(client);
    if (!service) return [];
    const { data } = await service
        .from("catalog_products")
        .select("*")
        .eq("status", "draft")
        .order("created_at");
    return (data as CatalogRow[] | null) ?? [];
}

export interface ImportDraftInput {
    source: string;
    providerItemId: string;
    sourceUrl?: string | null;
    title: string;
    images?: string[];
    listingPrice?: number | null;
    listingCurrency?: string | null;
    category?: string | null;
    supplierVariant?: Record<string, unknown> | null;
    fields?: Record<string, unknown>;
    createdBy: string;
}

export async function importDraft(
    input: ImportDraftInput,
    client?: SupabaseClientLike
): Promise<{ created: boolean; id: string } | { error: string }> {
    // Policy gate before any client work or insert: research sources can never
    // create catalog rows, no matter which endpoint calls this.
    if (RESEARCH_ONLY_SOURCES.has(input.source)) {
        return { error: RESEARCH_ONLY_MESSAGE };
    }
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };

    const fields = input.fields ?? {};
    const draft = { ...buildDraftInsert(input), ...fields };
    const { error } = await service.from("catalog_products").insert(draft);
    if (error) {
        if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) {
            const { data: existing } = await service
                .from("catalog_products")
                .select("id")
                .eq("source", input.source)
                .eq("provider_item_id", input.providerItemId)
                .maybeSingle();
            const row = existing as { id: string } | null;
            if (row) return { created: false, id: row.id };
        }
        return { error: error.message };
    }
    return { created: true, id: draft.id };
}

export async function updateDraft(
    id: string,
    fields: Record<string, unknown>,
    client?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };
    if (Object.keys(fields).length === 0) return { ok: true };

    const { data, error } = await service
        .from("catalog_products")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "draft")
        .select("id");

    if (error) return { error: error.message };
    if (!data || (data as unknown[]).length === 0) {
        return { error: "draft not found" };
    }
    return { ok: true };
}

export async function publishDraft(
    id: string,
    reviewerId: string,
    fields: Record<string, unknown> = {},
    client?: SupabaseClientLike
): Promise<{ ok: true } | { error: string; missing?: string[] }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };

    const { data: draftData } = await service
        .from("catalog_products")
        .select("*")
        .eq("id", id)
        .eq("status", "draft")
        .maybeSingle();
    const draft = draftData as CatalogRow | null;
    if (!draft) return { error: "draft not found" };

    const merged = { ...draft, ...fields };
    const validation = validatePublishable(merged as CatalogRow);
    if (!validation.valid) {
        return { error: "draft is not ready to publish", missing: validation.missing };
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await service
        .from("catalog_products")
        .update({
            ...fields,
            status: "published",
            reviewed_by: reviewerId,
            published_at: now,
            updated_at: now,
        })
        .eq("id", id)
        .eq("status", "draft")
        .eq("updated_at", draft.updated_at)
        .select("id");

    if (error) return { error: error.message };
    if (!updated || (updated as unknown[]).length === 0) {
        return { error: "draft changed during review; reload and retry" };
    }
    return { ok: true };
}

export async function discardDraft(
    id: string,
    client?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };
    const { data, error } = await service
        .from("catalog_products")
        .delete()
        .eq("id", id)
        .eq("status", "draft")
        .select("id");
    if (error) return { error: error.message };
    if (!data || (data as unknown[]).length === 0) {
        return { error: "draft not found" };
    }
    return { ok: true };
}

export async function deleteArchivedProduct(
    id: string,
    client?: SupabaseClientLike
): Promise<{ ok: true } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };
    const { data, error } = await service
        .from("catalog_products")
        .delete()
        .eq("id", id)
        .eq("status", "archived")
        .select("id");
    if (error) return { error: error.message };
    if (!data || (data as unknown[]).length === 0) {
        return { error: "archived product not found" };
    }
    return { ok: true };
}

const MANAGE_PAGE_MAX = 100;

export async function listCatalogProducts(
    client?: SupabaseClientLike,
    opts: { limit?: number; offset?: number } = {}
): Promise<{ products: CatalogRow[] } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };
    const limit =
        Number.isInteger(opts.limit) && (opts.limit as number) > 0
            ? Math.min(opts.limit as number, MANAGE_PAGE_MAX)
            : MANAGE_PAGE_MAX;
    const offset = Number.isInteger(opts.offset) && (opts.offset as number) >= 0 ? (opts.offset as number) : 0;
    const { data, error } = await service
        .from("catalog_products")
        .select("*")
        .order("created_at")
        .range(offset, offset + limit - 1);
    if (error) return { error: error.message };
    return { products: (data as CatalogRow[] | null) ?? [] };
}

export interface UpdateProductResult {
    ok: true;
    status: string;
}

export async function updateProduct(
    id: string,
    fields: Record<string, unknown>,
    expectedUpdatedAt?: string,
    client?: SupabaseClientLike
): Promise<UpdateProductResult | { error: string; missing?: string[] }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };

    const { data: rowData } = await service
        .from("catalog_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    const row = rowData as CatalogRow | null;
    if (!row) return { error: "product not found" };
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== row.updated_at) {
        return { error: "product changed during edit; reload and retry" };
    }

    const merged = { ...row, ...fields };
    if (row.status === "published") {
        // a published row must remain publishable: same guard as publish,
        // but stock 0 (sold out) is a valid state for a live product
        const validation = validatePublishable(merged as CatalogRow, { allowSoldOut: true });
        if (!validation.valid) {
            return { error: "product is not publishable", missing: validation.missing };
        }
    }

    const { data: updated, error } = await service
        .from("catalog_products")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");

    if (error) return { error: error.message };
    if (!updated || (updated as unknown[]).length === 0) {
        return { error: "product changed during edit; reload and retry" };
    }
    return { ok: true, status: row.status };
}

export async function archiveProduct(
    id: string,
    expectedUpdatedAt?: string,
    client?: SupabaseClientLike
): Promise<{ ok: true; wasPublished: boolean } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };

    const { data: rowData } = await service
        .from("catalog_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    const row = rowData as CatalogRow | null;
    if (!row) return { error: "product not found" };
    if (row.status !== "draft" && row.status !== "published") {
        return { error: "product already archived" };
    }
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== row.updated_at) {
        return { error: "product changed during edit; reload and retry" };
    }
    const wasPublished = row.status === "published";

    const { data: updated, error } = await service
        .from("catalog_products")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");

    if (error) return { error: error.message };
    if (!updated || (updated as unknown[]).length === 0) {
        return { error: "product changed during edit; reload and retry" };
    }
    return { ok: true, wasPublished };
}

export async function publishCatalogProduct(
    id: string,
    reviewerId: string,
    fields: Record<string, unknown> = {},
    expectedUpdatedAt?: string,
    client?: SupabaseClientLike
): Promise<{ ok: true } | { error: string; missing?: string[] }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };

    const { data: rowData } = await service
        .from("catalog_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    const row = rowData as CatalogRow | null;
    if (!row || (row.status !== "draft" && row.status !== "archived")) {
        return { error: "product not found" };
    }
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== row.updated_at) {
        return { error: "product changed during review; reload and retry" };
    }

    const merged = { ...row, ...fields };
    const validation = validatePublishable(merged as CatalogRow);
    if (!validation.valid) {
        return { error: "product is not ready to publish", missing: validation.missing };
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await service
        .from("catalog_products")
        .update({
            ...fields,
            status: "published",
            reviewed_by: reviewerId,
            published_at: now,
            updated_at: now,
        })
        .eq("id", id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");

    if (error) return { error: error.message };
    if (!updated || (updated as unknown[]).length === 0) {
        return { error: "product changed during review; reload and retry" };
    }
    return { ok: true };
}

type SupplierLookup = (
    service: SupabaseClientLike,
    source: ImportSource,
    productId: string,
    variantId?: string
) => Promise<{ preview: SupplierPreview } | { error: string }>;

// Only importable-supplier rows can be synced against a live supplier;
// AliExpress/CJ rows are research/historical under the sourcing policy.
const SUPPLIER_SOURCES = IMPORTABLE_SUPPLIER_SOURCES;

// Re-reads the provider's current price/stock for a catalog row and updates
// only supplier fields. Customer-facing text/images/sale price/status/rights
// are never touched by a sync.
export async function refreshSupplierProduct(
    id: string,
    expectedUpdatedAt: string,
    client?: SupabaseClientLike,
    lookup?: SupplierLookup
): Promise<{ ok: true; warnings: string[]; fetchedAt: string | null } | { error: string }> {
    const service = await serviceClient(client);
    if (!service) return { error: "service unavailable" };
    if (!lookup) {
        const mod = await import("../suppliers/importService.ts");
        lookup = mod.lookupSupplierPreview;
    }

    const { data, error } = await service
        .from("catalog_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error) return { error: error.message };
    const row = data as CatalogRow | null;
    if (!row) return { error: "product not found" };
    if (row.status === "archived") return { error: "product is archived" };
    if (row.status !== "draft" && row.status !== "published") {
        return { error: "product status does not allow sync" };
    }
    if (row.updated_at !== expectedUpdatedAt) {
        return { error: "product changed during review; reload and retry" };
    }
    if (!SUPPLIER_SOURCES.has(row.source) || !row.supplier_variant) {
        return { error: "product has no supplier variant to sync" };
    }
    const variantRef = row.supplier_variant as Record<string, unknown>;
    const productId = variantRef.product_id;
    const variantId = variantRef.variation_id;
    if (typeof productId !== "string" || !productId) {
        return { error: "supplier variant reference is incomplete" };
    }
    // Never guess the variant: a missing stored variation_id must abort the
    // sync rather than letting the lookup auto-choose a different variant.
    if (typeof variantId !== "string" || !variantId) {
        return { error: "supplier variant reference is incomplete" };
    }

    const result = await lookup(
        service,
        row.source as ImportSource,
        productId,
        variantId
    );
    if ("error" in result) return { error: result.error };
    const preview = result.preview;
    if (
        preview.product.source !== row.source ||
        preview.product.productId !== productId ||
        preview.selectedVariantId !== variantId
    ) {
        return { error: "provider returned a different product or variant; nothing was updated" };
    }
    const pricing = supplierPricing(preview, { marginPercent: 15, freightId: null });
    const variant = pricing.variant;
    if (!variant) return { error: "supplier variant no longer exists at the provider" };
    if (variant.stock === null || pricing.cost === null) {
        return { error: "provider did not return verifiable stock and cost; nothing was updated" };
    }

    const { data: changed, error: writeError } = await service
        .from("catalog_products")
        .update({
            stock: variant.stock,
            listing_price: variant.price,
            listing_currency: variant.currency,
            supplier_cost_cop: pricing.cost,
            fx_rate: preview.fx?.rate ?? null,
            fx_rate_date: preview.fx?.date ?? null,
            supplier_variant: {
                ...variantRef,
                ...variant.attributes,
                provider_stock: variant.stock,
                provider_price: variant.price,
                currency_code: variant.currency,
                fetched_at: preview.product.fetchedAt,
            },
            updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
    if (writeError) return { error: writeError.message };
    if (!changed || (changed as unknown[]).length === 0) {
        return { error: "product changed during review; reload and retry" };
    }

    const warnings: string[] = [];
    if (preview.freight.length === 0) {
        warnings.push("La cotización de envío del proveedor no está disponible en esta consulta.");
    }
    if (pricing.cost !== null && row.price_cop > 0 && pricing.cost >= row.price_cop) {
        warnings.push("El nuevo costo del proveedor es igual o mayor que el precio de venta actual; revisa el margen manualmente.");
    }
    return { ok: true, warnings, fetchedAt: preview.product.fetchedAt };
}
