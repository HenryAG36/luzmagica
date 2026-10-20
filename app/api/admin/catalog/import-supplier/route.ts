import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { adminJson, checkAdminOrigin } from "@/lib/api/guards";
import { importDraft } from "@/lib/catalog/repository";
import { buildSupplierImport } from "@/lib/catalog/supplierImport";
import {
    lookupSupplierPreview,
    validateImportBody,
} from "@/lib/suppliers/importService";

export const maxDuration = 60;

// Supplier-sourced draft import. Client-supplied title/images/stock/price are
// NEVER trusted: the body carries only the selection (source/product/variant/
// freight/margin/optional manual price) and the provider is re-queried here.
export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return adminJson({ error: "unauthorized" }, { status: auth.status });
    }
    const forbidden = checkAdminOrigin(request);
    if (forbidden) return forbidden;

    const service = getServiceRoleClient();
    if (!service) {
        return adminJson({ error: "service unavailable" }, { status: 503 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return adminJson({ error: "invalid body" }, { status: 400 });
    }
    if (typeof body === "object" && body !== null) {
        // ignore anything outside the contract keys
        body = {
            source: (body as Record<string, unknown>).source,
            productId: (body as Record<string, unknown>).productId,
            variantId: (body as Record<string, unknown>).variantId,
            freightId: (body as Record<string, unknown>).freightId,
            marginPercent: (body as Record<string, unknown>).marginPercent,
            priceCop: (body as Record<string, unknown>).priceCop,
        };
    }
    const parsed = validateImportBody(body);
    if ("error" in parsed) {
        return adminJson({ error: parsed.error }, { status: 400 });
    }

    const result = await lookupSupplierPreview(
        service,
        parsed.source,
        parsed.productId,
        parsed.variantId
    );
    if ("error" in result) {
        return adminJson({ error: result.error }, { status: 502 });
    }

    const draft = buildSupplierImport(result.preview, {
        marginPercent: parsed.marginPercent,
        freightId: parsed.freightId,
        priceCop: parsed.priceCop,
    }, auth.user.id);
    if ("error" in draft) {
        const stale = draft.error.includes("cambió") || draft.error.includes("nuevamente");
        return adminJson({ error: draft.error }, { status: stale ? 409 : 400 });
    }

    const imported = await importDraft(draft, service);
    if ("error" in imported) {
        return adminJson({ error: imported.error }, { status: 400 });
    }
    return adminJson(
        { id: imported.id, created: imported.created, warnings: result.preview.warnings },
        { status: imported.created ? 201 : 200 }
    );
}
