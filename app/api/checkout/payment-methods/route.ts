import { NextResponse } from "next/server";
import { isMastershopCodEnabled } from "@/lib/env";

// Public capability flag only — the server still re-validates source,
// membership, stock and weight on order submission.
export async function GET() {
    return NextResponse.json(
        { cashOnDelivery: isMastershopCodEnabled() },
        { headers: { "cache-control": "no-store" } }
    );
}
