import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const metadata = {
    title: "Iniciar Sesión | LuzMágica",
    description: "Inicia sesión en tu cuenta de cliente LuzClub VIP o accede al portal administrativo de LuzMágica.",
};

export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                    <div className="animate-pulse text-muted">Cargando acceso seguro...</div>
                </div>
            }
        >
            <LoginClient />
        </Suspense>
    );
}
