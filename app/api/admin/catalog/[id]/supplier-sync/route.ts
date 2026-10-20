import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/auth/server";
import { adminJson, checkAdminOrigin } from "@/lib/api/guards";
import { isPlainObject } from "@/lib/catalog/validate";
import { refreshSupplierProduct } from "@/lib/catalog/repository";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export const maxDuration = 60;

// Manually refreshes supplier stock/cost/FX for a catalog row. Optimistic
// concurrency: the row must still be at expectedUpdatedAt. Customer-facing
// text/images/sale price/status are never modified.
export async function POST(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return adminJson({ error: "unauthorized" }, { status: auth.status });
    }
    const forbidden = checkAdminOrigin(request);
    if (forbidden) return forbidden;

    const { id } = await context.params;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return adminJson({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body) || typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt) {
        return adminJson({ error: "expectedUpdatedAt required" }, { status: 400 });
    }

    const result = await refreshSupplierProduct(id, body.expectedUpdatedAt);
    if ("error" in result) {
        if (result.error.includes("changed")) {
            return adminJson(result, { status: 409 });
        }
        if (result.error === "service unavailable") {
            return adminJson(result, { status: 503 });
        }
        if (result.error === "product not found") {
            return adminJson(result, { status: 404 });
        }
        return adminJson(result, { status: 502 });
    }

    revalidatePath("/");
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return adminJson(result);
}
