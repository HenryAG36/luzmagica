import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/auth/server";
import { discardDraft, publishDraft, updateDraft } from "@/lib/catalog/repository";
import { isPlainObject, sanitizeReviewFields } from "@/lib/catalog/validate";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

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

    const { fields, errors } = sanitizeReviewFields(body.fields);
    if (errors.length > 0) {
        return NextResponse.json({ error: `invalid fields: ${errors.join(", ")}` }, { status: 400 });
    }

    if (body.action === "publish") {
        const result = await publishDraft(id, auth.user.id, fields);
        if ("error" in result) {
            return NextResponse.json(result, { status: result.error.includes("changed during review") ? 409 : 400 });
        }
        revalidatePath("/");
        revalidatePath("/products");
        revalidatePath(`/products/${id}`);
        return NextResponse.json({ ok: true });
    }

    const result = await updateDraft(id, fields);
    if ("error" in result) {
        return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const { id } = await context.params;
    const result = await discardDraft(id);
    if ("error" in result) {
        return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
