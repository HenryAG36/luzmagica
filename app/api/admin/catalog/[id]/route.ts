import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/auth/server";
import {
    archiveProduct,
    discardDraft,
    publishCatalogProduct,
    updateProduct,
} from "@/lib/catalog/repository";
import { isPlainObject, sanitizeReviewFields } from "@/lib/catalog/validate";

interface RouteContext {
    params: Promise<{ id: string }>;
}

function checkOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get("origin");
    if (!origin) return null;
    try {
        if (new URL(origin).origin !== new URL(request.url).origin) {
            return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
    return null;
}

function revalidateStorefront(id: string) {
    revalidatePath("/");
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
}

export async function PATCH(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const forbidden = checkOrigin(request);
    if (forbidden) return forbidden;

    const { id } = await context.params;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const action = body.action === undefined ? "update" : body.action;
    if (action !== "publish" && action !== "update" && action !== "archive") {
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const expectedUpdatedAt =
        typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;

    const { fields, errors } = sanitizeReviewFields(body.fields);
    if (errors.length > 0) {
        return NextResponse.json({ error: `invalid fields: ${errors.join(", ")}` }, { status: 400 });
    }

    if (action === "publish") {
        const result = await publishCatalogProduct(id, auth.user.id, fields, expectedUpdatedAt);
        if ("error" in result) {
            return NextResponse.json(result, { status: result.error.includes("changed") ? 409 : 400 });
        }
        revalidateStorefront(id);
        return NextResponse.json({ ok: true });
    }

    if (action === "archive") {
        const result = await archiveProduct(id, expectedUpdatedAt);
        if ("error" in result) {
            return NextResponse.json(result, { status: result.error.includes("changed") ? 409 : 400 });
        }
        if (result.wasPublished) revalidateStorefront(id);
        return NextResponse.json({ ok: true });
    }

    const result = await updateProduct(id, fields, expectedUpdatedAt);
    if ("error" in result) {
        return NextResponse.json(result, { status: result.error.includes("changed") ? 409 : 400 });
    }
    if (result.status === "published") revalidateStorefront(id);
    return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const forbidden = checkOrigin(request);
    if (forbidden) return forbidden;

    const { id } = await context.params;
    const result = await discardDraft(id);
    if ("error" in result) {
        return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
