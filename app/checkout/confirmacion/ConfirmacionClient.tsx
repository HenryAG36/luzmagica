"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, XCircle, Package, Search } from "lucide-react";
import { formatCOP } from "@/lib/utils";
import type { PublicOrder } from "@/lib/orders/types";
import FadeIn from "@/components/common/FadeIn";

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_MS = 2 * 60 * 1000;

export default function ConfirmacionClient() {
    const searchParams = useSearchParams();
    const ref = searchParams.get("ref") ?? "";
    const token = searchParams.get("t") ?? "";

    const [order, setOrder] = useState<PublicOrder | null>(null);
    const [error, setError] = useState("");
    const startRef = useRef(0);

    useEffect(() => {
        if (!ref || !token) {
            setError("Enlace de confirmación inválido.");
            return;
        }
        startRef.current = Date.now();
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            try {
                const res = await fetch("/api/orders/status", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ref, token }),
                });
                if (cancelled) return;
                if (res.ok) {
                    const body = await res.json();
                    const next = body.order as PublicOrder;
                    setOrder(next);
                    if (next.paymentStatus === "pending_payment") {
                        if (Date.now() - startRef.current < POLL_MAX_MS) {
                            timer = setTimeout(poll, POLL_INTERVAL_MS);
                        }
                    }
                } else if (res.status === 404) {
                    setError("No encontramos este pedido.");
                } else {
                    setError("No pudimos verificar el estado del pago.");
                }
            } catch {
                if (!cancelled && Date.now() - startRef.current < POLL_MAX_MS) {
                    timer = setTimeout(poll, POLL_INTERVAL_MS);
                }
            }
        };
        void poll();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [ref, token]);

    const heading = () => {
        if (!order) return { icon: <Clock className="w-10 h-10 text-amber-300" />, title: "Verificando tu pago…" };
        switch (order.paymentStatus) {
            case "paid":
                return {
                    icon: <CheckCircle2 className="w-10 h-10 text-green-400" />,
                    title: "¡Pago confirmado!",
                };
            case "pending_payment":
                return { icon: <Clock className="w-10 h-10 text-amber-300" />, title: "Pago en proceso" };
            case "payment_review":
                return { icon: <Clock className="w-10 h-10 text-amber-300" />, title: "Pago en revisión" };
            default:
                return { icon: <XCircle className="w-10 h-10 text-red-300" />, title: "El pago no se completó" };
        }
    };

    const { icon, title } = heading();

    return (
        <div className="pt-28 pb-16 px-4 min-h-screen">
            <div className="max-w-lg mx-auto">
                <FadeIn>
                    <div className="glass rounded-3xl p-8 text-center">
                        <div className="w-20 h-20 rounded-full bg-surface-card border border-white/10 flex items-center justify-center mx-auto mb-5">
                            {icon}
                        </div>
                        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-white mb-2">{title}</h1>
                        {ref && <p className="text-xs font-mono text-muted mb-4">Referencia: #{ref}</p>}

                        {order?.paymentStatus === "pending_payment" && (
                            <p className="text-xs text-muted mb-4">
                                La pasarela aún no confirma tu pago. Si elegiste un método con procesamiento
                                diferido (como PSE), puede tardar unos minutos — puedes seguir el estado en{" "}
                                <Link href="/tracking" className="text-primary hover:underline">
                                    Rastreo de pedido
                                </Link>
                                .
                            </p>
                        )}
                        {order?.paymentStatus === "paid" && (
                            <p className="text-xs text-muted mb-4">
                                Tu pedido fue registrado y será preparado con el proveedor. Guarda tu referencia
                                para consultar el despacho.
                            </p>
                        )}
                        {order && order.paymentStatus !== "pending_payment" && order.paymentStatus !== "paid" && order.paymentStatus !== "payment_review" && (
                            <p className="text-xs text-muted mb-4">
                                Si el cargo aparece en tu cuenta, contáctanos con tu referencia y lo verificamos.
                            </p>
                        )}

                        {order && (
                            <div className="text-left p-4 rounded-2xl bg-surface-card border border-white/5 mb-5 text-xs space-y-1.5">
                                {order.items.map((item) => (
                                    <div key={item.productId} className="flex justify-between text-muted">
                                        <span className="line-clamp-1 mr-2">
                                            {item.name} × {item.quantity}
                                        </span>
                                        <span className="text-white shrink-0">
                                            {formatCOP(item.unitPriceCop * item.quantity)}
                                        </span>
                                    </div>
                                ))}
                                <div className="flex justify-between pt-2 border-t border-white/10 text-muted">
                                    <span>Envío</span>
                                    <span className="text-white">{formatCOP(order.shippingCop)}</span>
                                </div>
                                <div className="flex justify-between font-bold text-white">
                                    <span>Total</span>
                                    <span>{formatCOP(order.totalCop)}</span>
                                </div>
                            </div>
                        )}

                        {error && <p className="text-xs text-red-300 mb-4">{error}</p>}

                        <div className="flex flex-col gap-2">
                            {order?.paymentStatus === "paid" && (
                                <Link
                                    href="/tracking"
                                    className="w-full py-3 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold text-xs flex items-center justify-center gap-2 glow-purple"
                                >
                                    <Package className="w-4 h-4" />
                                    Rastrear mi pedido
                                </Link>
                            )}
                            <Link
                                href="/tracking"
                                className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center justify-center gap-2 border border-white/10"
                            >
                                <Search className="w-4 h-4" />
                                Consultar con referencia + teléfono
                            </Link>
                            <Link href="/products" className="text-xs text-muted hover:text-white pt-1">
                                Volver a la tienda
                            </Link>
                        </div>
                    </div>
                </FadeIn>
            </div>
        </div>
    );
}
