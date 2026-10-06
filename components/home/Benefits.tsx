"use client";

import { Truck, Shield, RotateCcw, Headphones } from "lucide-react";
import FadeIn from "@/components/common/FadeIn";

const benefits = [
    {
        icon: Truck,
        title: "Envíos Cotizados",
        description: "El costo y tiempo de entrega se confirman por producto antes de finalizar el pedido.",
        color: "text-secondary",
    },
    {
        icon: Shield,
        title: "Productos Revisados",
        description: "Cada producto del catálogo pasa por revisión interna antes de publicarse.",
        color: "text-primary",
    },
    {
        icon: RotateCcw,
        title: "Devoluciones por Producto",
        description: "Las condiciones de cambio y devolución se definen según cada producto.",
        color: "text-accent",
    },
    {
        icon: Headphones,
        title: "Atención por WhatsApp",
        description: "Escríbenos para resolver dudas sobre productos o pedidos.",
        color: "text-secondary",
    },
];

export default function Benefits() {
    return (
        <section className="py-24 px-4 relative">
            <div className="absolute inset-0 ambient-gradient" />
            <div className="max-w-7xl mx-auto relative z-10">
                <FadeIn>
                    <div className="text-center mb-16">
                        <span className="text-secondary text-sm font-medium uppercase tracking-widest">
                            ¿Por qué elegirnos?
                        </span>
                        <h2 className="font-heading text-4xl sm:text-5xl font-bold mt-3">
                            La Experiencia <span className="gradient-text">LuzMágica</span>
                        </h2>
                    </div>
                </FadeIn>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {benefits.map((benefit, i) => (
                        <FadeIn key={benefit.title} delay={i * 0.1}>
                            <div className="glass rounded-2xl p-6 text-center group hover:glow-purple transition-all duration-500">
                                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl glass mb-4 ${benefit.color}`}>
                                    <benefit.icon className="w-6 h-6" />
                                </div>
                                <h3 className="font-heading font-semibold text-white mb-2">
                                    {benefit.title}
                                </h3>
                                <p className="text-sm text-muted leading-relaxed">
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
