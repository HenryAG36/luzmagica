import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { adminJson, checkAdminOrigin } from "@/lib/api/guards";
import {
    lookupSupplierPreview,
    validatePreviewBody,
} from "@/lib/suppliers/importService";

export const maxDuration = 60;

// Server-side supplier product preview: fetches the official provider API
// (detail → variant stock → freight) plus the FX rate. Returns normalized
// SupplierPreview — the client never supplies prices or stock.
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
    const parsed = validatePreviewBody(body);
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
    return adminJson({ preview: result.preview });
}
