"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Award, Gift, TrendingUp, UserRound } from "lucide-react";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Club Honesty explainer. Intentionally shows no browser-side points
 * balance — the authoritative balance lives server-side and is visible in
 * /account and applied at checkout for signed-in members.
 */
export default function LoyaltyModal() {
    const { isModalOpen, closeModal } = useLoyaltyStore();
    const { currentUser } = useAuthStore();
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isModalOpen && !dialog.open) {
            triggerRef.current = (document.activeElement as HTMLElement) ?? null;
            dialog.showModal();
            document.body.style.overflow = "hidden";
            dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isModalOpen]);

    const close = useCallback(() => {
        dialogRef.current?.close();
        closeModal();
        triggerRef.current?.focus?.();
    }, [closeModal]);

    if (!isModalOpen) return null;

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="loyalty-title"
            className="motion-reveal m-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-3xl border border-black/10 bg-surface p-0 shadow-2xl"
            onCancel={close}
            onClose={closeModal}
            onClick={(e) => {
                if (e.target === dialogRef.current) close();
            }}
        >
            <div className="relative p-6 md:p-8">
                <div className="absolute left-0 right-0 top-0 h-1 rounded-t-3xl bg-accent" />

                <button
                    type="button"
                    data-autofocus
                    onClick={close}
                    className="absolute right-5 top-5 rounded-full p-2 text-muted transition-colors hover:bg-black/5 hover:text-foreground"
                    aria-label="Cerrar"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-white">
                        <Award className="h-6 w-6" aria-hidden />
                    </div>
                    <div>
                        <h2 id="loyalty-title" className="font-heading text-2xl font-semibold">
                            Club Honesty
                        </h2>
                        <p className="text-xs text-muted">Puntos por tus compras, canjeables al pagar</p>
                    </div>
                </div>

                <div className="mb-6 space-y-3">
                    <div className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface-light p-3.5">
                        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                        <div>
                            <h3 className="text-xs font-semibold">Acumula puntos</h3>
                            <p className="text-[11px] leading-relaxed text-muted">
                                Con una cuenta, cada compra pagada suma Puntos Honesty según tu nivel.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface-light p-3.5">
                        <Gift className="mt-0.5 h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                        <div>
                            <h3 className="text-xs font-semibold">Canjea al pagar</h3>
                            <p className="text-[11px] leading-relaxed text-muted">
                                Tus puntos se aplican como descuento directo en el checkout.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl border border-black/10 bg-surface-light p-3.5">
                        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-accent-dark" aria-hidden />
                        <div>
                            <h3 className="text-xs font-semibold">Saldo en tu cuenta</h3>
                            <p className="text-[11px] leading-relaxed text-muted">
                                Tu balance real y tu historial se consultan en Mi Cuenta.
                            </p>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        close();
                        router.push(currentUser ? "/account" : "/login");
                    }}
                    className="w-full rounded-full bg-foreground px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light"
                >
                    {currentUser ? "Ver mi cuenta y saldo" : "Crear cuenta o iniciar sesión"}
                </button>
            </div>
        </dialog>
    );
}
