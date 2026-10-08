import { NextResponse } from "next/server";
import { submitCustomerClaim, MAX_EVIDENCE_FILES, MAX_EVIDENCE_BYTES } from "@/lib/orders/claims";

// Customer claim submission: multipart form with ref + contact (the same
// ownership proof as order lookup) or the checkout lookup token. Evidence
// files go to a private bucket; access is via short-lived signed URLs.
export async function POST(request: Request) {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const ref = form.get("ref");
    const contact = form.get("contact");
    const token = form.get("token");
    const productId = form.get("productId");
    const reason = form.get("reason");
    const description = form.get("description");

    if (
        typeof ref !== "string" ||
        typeof productId !== "string" ||
        typeof reason !== "string" ||
        typeof description !== "string" ||
        (typeof contact !== "string" && typeof token !== "string")
    ) {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const files: { name: string; type: string; bytes: ArrayBuffer }[] = [];
    for (const entry of form.getAll("files")) {
        if (!(entry instanceof File) || entry.size === 0) continue;
        files.push({ name: entry.name || "file", type: entry.type, bytes: await entry.arrayBuffer() });
        if (files.length > MAX_EVIDENCE_FILES) break;
    }

    const result = await submitCustomerClaim({
        ref,
        contact: typeof contact === "string" ? contact : null,
        token: typeof token === "string" ? token : null,
        productId,
        reason,
        description,
        files,
    });
    if ("error" in result) {
        // Same response for unknown ref and mismatched credentials.
        const status =
            result.error === "order not found"
                ? 404
                : result.error === "claim already exists"
                  ? 409
                  : 400;
        const message =
            result.error === "order not found"
                ? "not found"
                : result.error === "claim already exists"
                  ? "Ya registramos un reclamo por este motivo en ese producto."
                  : result.error === "order is not claimable"
                    ? "Este pedido aún no permite reclamos."
                    : result.error === "product not in this order"
                      ? "El producto no pertenece a este pedido."
                      : result.error === "invalid description"
                        ? "Describe el problema con al menos 10 caracteres."
                        : result.error === "invalid reason"
                          ? "Motivo inválido."
                          : result.error === "too many files"
                            ? `Máximo ${MAX_EVIDENCE_FILES} archivos de hasta ${Math.round(MAX_EVIDENCE_BYTES / 1048576)}MB.`
                            : result.error.includes("file type")
                              ? "Solo se aceptan imágenes o videos (jpg, png, webp, mp4, mov, webm)."
                              : result.error.includes("file size")
                                ? "Cada archivo debe pesar menos de 5MB."
                                : "No se pudo registrar el reclamo.";
        return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ ok: true, claimId: result.claimId });
}
