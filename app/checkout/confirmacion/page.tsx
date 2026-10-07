import { Metadata } from "next";
import { Suspense } from "react";
import ConfirmacionClient from "./ConfirmacionClient";

export const metadata: Metadata = {
    title: "Confirmación de Pago | LuzMágica",
    description: "Estado de tu pago y pedido en LuzMágica.",
};

export default function ConfirmacionPage() {
    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Verificando tu pago...</div>
                </div>
            }
        >
            <ConfirmacionClient />
        </Suspense>
    );
}
