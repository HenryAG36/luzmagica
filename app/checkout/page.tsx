import { Metadata } from "next";
import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";

export const metadata: Metadata = {
    title: "Checkout Seguro | LuzMágica",
    description: "Completa tu pedido de forma segura en LuzMágica con envío protegido.",
};

export default function CheckoutPage() {
    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Cargando checkout seguro...</div>
                </div>
            }
        >
            <CheckoutClient />
        </Suspense>
    );
}
