import { Suspense } from "react";
import AccountClient from "./AccountClient";

export const metadata = {
    title: "Mi Cuenta | LuzMágica",
    description: "Gestiona tu perfil, direcciones guardadas, historial de pedidos y puntos LuzClub VIP.",
};

export default function AccountPage() {
    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Cargando perfil...</div>
                </div>
            }
        >
            <AccountClient />
        </Suspense>
    );
}
