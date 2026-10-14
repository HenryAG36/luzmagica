"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, Gift, ArrowRight, MessageCircle } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { buildSupportWhatsAppUrl } from "@/lib/contact";

const SESSION_KEY = "honesty-exit-shown";
const MOBILE_DWELL_MS = 60_000;
const RAPID_RETURN_MAX_MS = 1000;
const RAPID_RETURN_TOP_Y = 40;
const RAPID_RETURN_MIN_DEPTH = 300;

/**
 * Cart-page-only retention dialog, shown once per session:
 * - fine pointer (desktop): mouse leaves the viewport top
 * - coarse pointer (mobile): 60s dwell OR a rapid return to the top after
 *   scrolling ≥300px down (within 1s)
 * Never fires while typing, while another dialog is open, off the cart
 * page, or when a coupon is already applied. No operator PII capture.
 */
export default function ExitIntentRecoveryModal() {
    const pathname = usePathname();
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const shownRef = useRef(false); // in-memory fallback for sessionStorage
    const lastScroll = useRef({ y: 0, t: 0 });
    const [isOpen, setIsOpen] = useState(false);

    const items = useCartStore((s) => s.items);
    const isCartOpen = useCartStore((s) => s.isCartOpen);
    const couponCode = useCartStore((s) => s.couponCode);
    const applyCoupon = useCartStore((s) => s.applyCoupon);

    const isCartPage = pathname === "/cart";

    const alreadyShown = () => {
        if (shownRef.current) return true;
        try {
            return sessionStorage.getItem(SESSION_KEY) === "1";
        } catch {
            return false;
        }
    };
    const markShown = () => {
        shownRef.current = true;
        try {
            sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
            // private mode — in-memory flag already set
        }
    };

    const tryTrigger = useCallback(() => {
        if (!isCartPage) return;
        if (items.length === 0 || isCartOpen || couponCode) return;
        if (alreadyShown()) return;
        if (document.querySelector("dialog[open]")) return;
        const active = document.activeElement as HTMLElement | null;
        if (
            active &&
            (["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) ||
                active.isContentEditable)
        ) {
            return; // don't interrupt typing; try again on next trigger event
        }
        markShown();
        triggerRef.current = active ?? null;
        setIsOpen(true);
    }, [isCartPage, items.length, isCartOpen, couponCode]);

    // Desktop exit intent — fine pointers only
    useEffect(() => {
        if (!isCartPage) return;
        if (typeof window.matchMedia !== "function") return;
        if (!window.matchMedia("(hover:hover) and (pointer:fine)").matches) return;
        const handleMouseLeave = (e: MouseEvent) => {
            if (e.clientY <= 10) tryTrigger();
        };
        document.addEventListener("mouseleave", handleMouseLeave);
        return () => document.removeEventListener("mouseleave", handleMouseLeave);
    }, [isCartPage, tryTrigger]);

    // Coarse-pointer fallback: 60s dwell OR rapid return to top
    useEffect(() => {
        if (!isCartPage) return;
        if (typeof window.matchMedia !== "function") return;
        if (!window.matchMedia("(pointer:coarse)").matches) return;

        const dwellTimer = window.setTimeout(tryTrigger, MOBILE_DWELL_MS);
        lastScroll.current = { y: window.scrollY, t: Date.now() };

        const handleScroll = () => {
            const now = Date.now();
            const prev = lastScroll.current;
            const y = window.scrollY;
            if (
                y <= RAPID_RETURN_TOP_Y &&
                prev.y >= RAPID_RETURN_MIN_DEPTH &&
                now - prev.t <= RAPID_RETURN_MAX_MS
            ) {
                tryTrigger();
            }
            lastScroll.current = { y, t: now };
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            window.clearTimeout(dwellTimer);
            window.removeEventListener("scroll", handleScroll);
        };
    }, [isCartPage, tryTrigger]);

    // Route-away or emptied cart: close + reset state
    useEffect(() => {
        if (!isCartPage || items.length === 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset driven by route/cart store
            setIsOpen(false);
        }
    }, [isCartPage, items.length]);

    // Sync dialog element: showModal + focus close button + scroll lock
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen && !dialog.open) {
            dialog.showModal();
            document.body.style.overflow = "hidden";
            dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [isOpen]);

    const close = useCallback(() => {
        setIsOpen(false);
        dialogRef.current?.close();
        triggerRef.current?.focus?.();
    }, []);

    const handleApplyAndCheckout = () => {
        applyCoupon("HONEST10");
        close();
        router.push("/checkout");
    };

    const supportUrl = buildSupportWhatsAppUrl(
        "Hola Honesty, tengo una pregunta sobre mi pedido antes de pagar.",
    );

    if (!isCartPage || items.length === 0) return null;

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="exit-modal-title"
            className="motion-reveal m-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-3xl border border-black/10 bg-surface p-0 shadow-2xl"
            onCancel={close}
            onClose={() => setIsOpen(false)}
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

                <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10 text-accent-dark">
                        <Gift className="h-6 w-6" aria-hidden />
                    </div>
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-accent-dark">
                            Antes de que te vayas
                        </span>
                        <h3 id="exit-modal-title" className="font-heading text-xl font-semibold md:text-2xl">
                            ¿Te llevamos esto en el carrito?
                        </h3>
                    </div>
                </div>

                <p className="mb-5 text-xs text-muted md:text-sm">
                    Aplica el cupón <strong className="font-semibold text-foreground">HONEST10</strong>{" "}
                    y obtén un 10% de descuento en el subtotal de tu pedido.
                </p>

                <div className="space-y-2.5">
                    <button
                        type="button"
                        onClick={handleApplyAndCheckout}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light"
                    >
                        <span>Aplicar HONEST10 e ir a pagar</span>
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>

                    {supportUrl ? (
                        <button
                            type="button"
                            onClick={() => {
                                close();
                                window.open(supportUrl, "_blank");
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-full border border-black/10 px-6 py-3 text-xs font-medium transition-colors hover:bg-black/5"
                        >
                            <MessageCircle className="h-4 w-4 text-success" aria-hidden />
                            <span>¿Tienes dudas? Consulta por WhatsApp</span>
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={close}
                        className="w-full rounded-full px-6 py-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    >
                        Seguir mirando el carrito
                    </button>
                </div>
            </div>
        </dialog>
    );
}
