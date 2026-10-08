import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { placeSupplierOrder } from "@/lib/suppliers/fulfillment";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const { id } = await params;
    const result = await placeSupplierOrder(id);
    if ("error" in result) {
        const status =
            result.error === "order not found"
                ? 404
                : result.error.includes("verified paid")
                  ? 400
                  : 502;
        return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
}
