import { NextResponse } from "next/server";
import { listApprovedReviewsForProduct } from "@/lib/orders/repository";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const reviews = await listApprovedReviewsForProduct(id);
    return NextResponse.json({ reviews });
}
