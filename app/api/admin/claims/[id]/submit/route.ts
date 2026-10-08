import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getClaimForAdmin } from "@/lib/orders/claims";
import { submitCjDispute } from "@/lib/suppliers/disputes";
import { CLAIM_REASON_LABELS } from "@/lib/orders/types";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// Operator-confirmed dispute submission. CJ claims go through the documented
// dispute API; AliExpress has no public dispute API, so those return a
// guided manual checklist and are marked submitted by the operator.
export async function POST(_request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const { id } = await context.params;

    const loaded = await getClaimForAdmin(id);
    if ("error" in loaded) {
        return NextResponse.json(loaded, { status: 404 });
    }
    const claim = loaded.claim;
    if (claim.status !== "draft") {
        return NextResponse.json({ error: "claim already handled" }, { status: 400 });
    }

    if (claim.provider === "cjdropshipping") {
        const result = await submitCjDispute(id);
        if ("error" in result) {
            return NextResponse.json(result, { status: 502 });
        }
        return NextResponse.json({ ok: true, submitted: true, disputeId: result.disputeId });
    }

    // AliExpress DS / manual: no dispute API exists. Provide the operator
    // with the exact manual steps and mark the claim as operator-handled.
    const guide =
        claim.provider === "aliexpress_ds"
            ? [
                  "Abre la app/web de AliExpress con la cuenta de compra.",
                  `Busca el pedido del proveedor: ${claim.supplier_order_id ?? "sin ref."}`,
                  "Orders → abre el pedido → 'Open Dispute'.",
                  `Motivo del reclamo: ${CLAIM_REASON_LABELS[claim.reason]}.`,
                  "Adjunta las evidencias del cliente (disponibles en esta vista).",
                  "Vuelve aquí y marca el reclamo como 'Enviada al proveedor'.",
              ]
            : [
                  "El producto no proviene de un proveedor integrado.",
                  "Gestiona el reembolso/cambio directamente con tu fuente.",
                  "Marca el reclamo como resuelto cuando el cliente esté atendido.",
              ];

    return NextResponse.json({ ok: true, submitted: false, guide });
}
