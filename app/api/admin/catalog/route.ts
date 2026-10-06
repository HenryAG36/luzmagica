import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { importDraft, listCatalogProducts, listDrafts } from "@/lib/catalog/repository";
import { isHttpUrl, isPlainObject, isValidProviderItemId, sanitizeImageList, sanitizeImportFields, sanitizeSupplierVariant } from "@/lib/catalog/validate";

const IMPORT_SOURCES = new Set(["mercadolibre", "aliexpress", "aliexpress_ds", "cjdropshipping"]);
const PAGE_MAX = 100;

function boundedInt(raw: string | null, fallback: number, max: number): number {
    const value = raw === null ? Number.NaN : Number(raw);
    if (!Number.isInteger(value) || value < 0) return fallback;
    return Math.min(value, max);
}

export async function GET(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "all") {
        const limit = boundedInt(new URL(request.url).searchParams.get("limit"), PAGE_MAX, PAGE_MAX);
        const offset = boundedInt(new URL(request.url).searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
        const result = await listCatalogProducts(undefined, { limit, offset });
        if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 502 });
        }
        return NextResponse.json({ products: result.products, limit, offset });
    }

    const drafts = await listDrafts();
    return NextResponse.json({ drafts });
}

export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const source = body.source;
    if (typeof source !== "string" || !IMPORT_SOURCES.has(source)) {
        return NextResponse.json({ error: "invalid source" }, { status: 400 });
    }
    if (!isValidProviderItemId(body.providerItemId)) {
        return NextResponse.json({ error: "invalid provider item id" }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) {
        return NextResponse.json({ error: "invalid title" }, { status: 400 });
    }
    if (body.sourceUrl !== undefined && body.sourceUrl !== null && !isHttpUrl(body.sourceUrl)) {
        return NextResponse.json({ error: "invalid source url" }, { status: 400 });
    }
    const images = sanitizeImageList(body.images) ?? [];
    const supplierVariant = sanitizeSupplierVariant(body.supplierVariant);
    if (body.supplierVariant !== undefined && body.supplierVariant !== null && supplierVariant === null) {
        return NextResponse.json({ error: "invalid supplier variant" }, { status: 400 });
    }
    let importFields: Record<string, unknown> | undefined;
    if (body.fields !== undefined && body.fields !== null) {
        const sanitized = sanitizeImportFields(body.fields);
        if (sanitized.errors.length > 0) {
            return NextResponse.json({ error: sanitized.errors[0] }, { status: 400 });
        }
        importFields = sanitized.fields;
    }

    const result = await importDraft({
        source,
        providerItemId: body.providerItemId,
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
        title,
        images,
        listingPrice: typeof body.listingPrice === "number" && Number.isFinite(body.listingPrice) ? body.listingPrice : null,
        listingCurrency: typeof body.listingCurrency === "string" ? body.listingCurrency : null,
        category: typeof body.category === "string" ? body.category : null,
        supplierVariant,
        fields: importFields,
        createdBy: auth.user.id,
    });

    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
