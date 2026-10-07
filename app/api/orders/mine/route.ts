import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth/server";
import { listOrdersByEmail } from "@/lib/orders/repository";

// Orders placed as a guest still land here when the checkout email matches
// the signed-in account's verified email.
export async function GET() {
    const user = await getVerifiedUser();
    if (!user || !user.email) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const orders = await listOrdersByEmail(user.email);
    return NextResponse.json({ orders });
}
