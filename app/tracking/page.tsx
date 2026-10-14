import { Suspense } from "react";
import TrackingClient from "./TrackingClient";

export const metadata = {
    title: "Seguimiento de Pedidos | Honesty",
    description: "Consulta el estado registrado de tu pedido con tu referencia y dato de contacto.",
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
