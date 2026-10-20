import { authorizeAdmin } from "@/lib/auth/server";
import { adminJson } from "@/lib/api/guards";
import { searchMastershopProducts } from "@/lib/suppliers/mastershop";

export const maxDuration = 30;

// Read-only Mastershop marketplace search. Upstream uses POST on the same
// path, but this endpoint only reads — it never mutates anything. The API key
// stays server-side; results contain normalized catalog data only.
export async function GET(request: Request) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return adminJson({ error: "unauthorized" }, { status: auth.status });
    }

    const params = new URL(request.url).searchParams;
    const query = (params.get("query") ?? "").trim();
    if (query.length > 120) {
        return adminJson({ error: "invalid query" }, { status: 400 });
    }
    const rawOffset = params.get("offset");
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
        return adminJson({ error: "invalid offset" }, { status: 400 });
    }

    const result = await searchMastershopProducts(query, offset);
    if ("error" in result) {
        const status = result.error === "invalid query" || result.error === "invalid offset" ? 400 : 502;
        return adminJson({ error: result.error }, { status });
    }
    return adminJson(result.page);
}
