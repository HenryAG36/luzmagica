import type { Product } from "../types";
import type { SupabaseClientLike } from "../supabase/types";
import {
    buildDraftInsert,
    toPublicProduct,
    validatePublishable,
} from "./validate.ts";
import type { CatalogRow, PublicProductRow } from "./validate.ts";

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

export async function listPublishedProducts(client?: SupabaseClientLike): Promise<Product[]> {
    const supabase = await anonClient(client);
    if (!supabase) return [];
    const { data, error } = await supabase
        .from("published_products")
        .select("*")
        .order("name");
    if (error || !data) return [];
    return (data as PublicProductRow[]).map(toPublicProduct);
}

export async function getPublishedProduct(id: string, client?: SupabaseClientLike): Promise<Product | null> {
    const supabase = await anonClient(client);
    if (!supabase) return null;
    const { data } = await supabase
        .from("published_products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    return data ? toPublicProduct(data as PublicProductRow) : null;
}

export async function listPublishedRelated(
    room: string,
    excludeId: string,
    client?: SupabaseClientLike
): Promise<Product[]> {
    const supabase = await anonClient(client);
    if (!supabase) return [];
    const { data } = await supabase
        .from("published_products")
        .select("*")
        .eq("room", room)
        .neq("id", excludeId)
        .limit(4);
    return ((data as PublicProductRow[] | null) ?? []).map(toPublicProduct);
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
