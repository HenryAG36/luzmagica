import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import {
    attachClaimEvidence,
    getClaimEvidenceUrls,
    MAX_EVIDENCE_FILES,
} from "@/lib/orders/claims";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// GET returns short-lived signed URLs for the private evidence bucket.
export async function GET(_request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const { id } = await context.params;
    const result = await getClaimEvidenceUrls(id);
    if ("error" in result) {
        return NextResponse.json(result, { status: result.error === "claim not found" ? 404 : 500 });
    }
    return NextResponse.json(result);
}

// POST attaches operator-collected evidence (multipart 'files').
export async function POST(request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }
    const { id } = await context.params;

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const files: { name: string; type: string; bytes: ArrayBuffer }[] = [];
    for (const entry of form.getAll("files")) {
        if (!(entry instanceof File) || entry.size === 0) continue;
        files.push({ name: entry.name || "file", type: entry.type, bytes: await entry.arrayBuffer() });
        if (files.length > MAX_EVIDENCE_FILES) break;
    }
    if (files.length === 0) {
        return NextResponse.json({ error: "no files" }, { status: 400 });
    }
    const result = await attachClaimEvidence(id, files);
    if ("error" in result) {
        return NextResponse.json(result, { status: result.error === "claim not found" ? 404 : 400 });
    }
    return NextResponse.json(result);
}
