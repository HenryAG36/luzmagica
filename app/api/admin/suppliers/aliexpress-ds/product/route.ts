import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { isValidDsProductId } from "@/lib/suppliers/aliexpressDs";
import { lookupDsProduct } from "@/lib/suppliers/dsService";
import { isPlainObject } from "@/lib/catalog/validate";

export async function POST(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!isPlainObject(body) || !isValidDsProductId(body.productId)) {
        return NextResponse.json({ error: "invalid product id" }, { status: 400 });
    }

    const result = await lookupDsProduct(service, body.productId);
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ product: result.product });
}
