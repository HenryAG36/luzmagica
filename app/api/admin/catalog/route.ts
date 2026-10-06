import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { importDraft, listDrafts } from "@/lib/catalog/repository";
import { isHttpUrl, isPlainObject, isValidProviderItemId, sanitizeImageList, sanitizeImportFields, sanitizeSupplierVariant } from "@/lib/catalog/validate";

const IMPORT_SOURCES = new Set(["mercadolibre", "aliexpress", "aliexpress_ds", "cjdropshipping"]);

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
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
