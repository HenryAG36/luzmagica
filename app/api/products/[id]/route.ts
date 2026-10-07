import { NextResponse } from "next/server";
import { getPublishedProduct } from "@/lib/catalog/repository";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// Public product read — used for live-price re-adds (reorder flows) so the
// cart never re-adds an item at a stale snapshot price.
export async function GET(_request: Request, context: RouteContext) {
    const { id } = await context.params;
    if (typeof id !== "string" || id.length > 128) {
        return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const product = await getPublishedProduct(id);
    if (!product) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ product });
}
