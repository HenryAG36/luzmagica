import { Suspense } from "react";
import { redirect } from "next/navigation";
import OperatorClient from "./OperatorClient";
import { getVerifiedAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata = {
    title: "Command Center del Operador | LuzMágica",
    description: "Panel de control diario, métricas de retención de audiencia, gestión de despachos dropshipping y recuperación de carritos.",
};

export default async function OperatorPage() {
    const admin = await getVerifiedAdmin();
    if (!admin) {
        redirect("/login?redirect=/operator");
    }

    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Cargando Command Center del Operador...</div>
                </div>
            }
        >
            <OperatorClient />
        </Suspense>
    );
}
