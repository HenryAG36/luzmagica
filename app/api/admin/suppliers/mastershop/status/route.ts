import { authorizeAdmin } from "@/lib/auth/server";
import { adminJson } from "@/lib/api/guards";
import { getMastershopApiKey, isMastershopCodEnabled } from "@/lib/env";

// Configuration status only. `configured` reflects env presence — it does not
// prove provider access (the panel probes the protected products query for
// that). Catalog search/detail is supported; COD submission/tracking are
// feature-flagged; freight and prepaid orders stay manual.
export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) return adminJson({ error: "unauthorized" }, { status: auth.status });
    return adminJson({
        configured: getMastershopApiKey() !== null,
        country: "CO",
        catalog: true,
        automaticOrders: false,
        shippingQuotes: false,
        tracking: true,
        cashOnDelivery: isMastershopCodEnabled(),
    });
}
