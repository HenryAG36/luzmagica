import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const metadata = {
    title: "Iniciar Sesión | Honesty",
    description: "Inicia sesión en tu cuenta de cliente Club Honesty o accede al portal administrativo.",
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
