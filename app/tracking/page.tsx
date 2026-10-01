import { Suspense } from "react";
import TrackingClient from "./TrackingClient";

export const metadata = {
    title: "Seguimiento en Vivo de Pedidos | LuzMágica",
    description: "Rastrea el estado de tu pedido de luces LED en tiempo real desde el despacho hasta la puerta de tu casa.",
};

export default function TrackingPage() {
    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Cargando rastreo de pedido...</div>
                </div>
            }
        >
            <TrackingClient />
        </Suspense>
    );
}
