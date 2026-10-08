import { NextResponse } from "next/server";
import { submitOrderReview } from "@/lib/orders/repository";
import { isPlainObject } from "@/lib/catalog/validate";

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const ref = typeof body.ref === "string" ? body.ref : null;
    const productId = typeof body.productId === "string" ? body.productId : null;
    const rating = typeof body.rating === "number" ? body.rating : NaN;
    const comment = typeof body.comment === "string" ? body.comment : "";
    const token = typeof body.token === "string" ? body.token : null;
    const contact = typeof body.contact === "string" ? body.contact : null;

    if (!ref || !productId || (!token && !contact)) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const result = await submitOrderReview({ ref, token, contact, productId, rating, comment });
    if ("error" in result) {
        // Same response for unknown ref and mismatched credentials.
        const status = result.error === "order not found" ? 404 : 400;
        const message =
            result.error === "order not found"
                ? "not found"
                : result.error === "only delivered orders can be reviewed"
                  ? "Solo puedes reseñar pedidos entregados."
                  : result.error === "already reviewed"
                    ? "Ya dejaste una reseña para este producto."
                    : result.error === "product not in this order"
                      ? "El producto no pertenece a este pedido."
                      : "Datos de reseña inválidos.";
        return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ ok: true, pendingModeration: true });
}
