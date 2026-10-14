import { ShieldCheck, Truck, RotateCcw, Star } from "lucide-react";
import FadeIn from "@/components/common/FadeIn";

const benefits = [
    {
        icon: ShieldCheck,
        title: "Pago seguro",
        description: "Nequi, PSE o tarjeta — procesado por Wompi al momento de pagar.",
    },
    {
        icon: Truck,
        title: "Envío cotizado",
        description: "El costo de envío se calcula por producto y se confirma antes del pago.",
    },
    {
        icon: RotateCcw,
        title: "Retracto legal",
        description: "Consulta las condiciones de retracto y devolución según la ley colombiana.",
    },
    {
        icon: Star,
        title: "Reseñas verificadas",
        description: "Calificaciones de compras reales de clientes que recibieron su pedido.",
    },
];

export default function Benefits() {
    return (
        <section className="relative px-4 py-16 sm:py-20">
            <div className="mx-auto max-w-7xl">
                <FadeIn>
                    <div className="mb-12 text-center">
                        <span className="text-xs font-medium uppercase tracking-[0.2em] text-accent-dark">
                            ¿Por qué Honesty?
                        </span>
                        <h2 className="mt-3 font-heading text-4xl font-semibold sm:text-5xl">
                            Una tienda, compromisos claros
                        </h2>
                    </div>
                </FadeIn>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {benefits.map((benefit, i) => (
                        <FadeIn key={benefit.title} delay={i * 0.08}>
                            <div className="glass h-full rounded-2xl p-6 text-center">
                                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent-dark">
                                    <benefit.icon className="h-5 w-5" aria-hidden />
                                </div>
                                <h3 className="mb-2 font-heading text-xl font-semibold">
                                    {benefit.title}
                                </h3>
                                <p className="text-sm leading-relaxed text-muted">
                                    {benefit.description}
                                </p>
                            </div>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    );
}
