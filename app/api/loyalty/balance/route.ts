import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth/server";
import { getLoyaltyBalance } from "@/lib/loyalty/service";

export async function GET() {
    const user = await getVerifiedUser();
    if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const balance = await getLoyaltyBalance(user.id);
    if ("error" in balance) {
        return NextResponse.json(balance, { status: 500 });
    }
    return NextResponse.json({ balance });
}
