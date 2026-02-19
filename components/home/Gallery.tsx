"use client";

import { motion } from "framer-motion";
import FadeIn from "@/components/common/FadeIn";

const galleryItems = [
    { emoji: "🌌", label: "Nebulosa", gradient: "from-purple-800/50 to-indigo-900/50" },
    { emoji: "🎮", label: "Gaming Setup", gradient: "from-pink-800/50 to-purple-900/50" },
    { emoji: "🛋️", label: "Living Room", gradient: "from-cyan-800/50 to-blue-900/50" },
    { emoji: "🌙", label: "Bedroom Vibes", gradient: "from-indigo-800/50 to-violet-900/50" },
    { emoji: "🍳", label: "Cocina LED", gradient: "from-amber-800/50 to-orange-900/50" },
    { emoji: "🎄", label: "Terraza", gradient: "from-green-800/50 to-emerald-900/50" },
];

export default function Gallery() {
    return (
        <section className="py-24 px-4">
            <div className="max-w-7xl mx-auto">
                <FadeIn>
                    <div className="text-center mb-16">
                        <span className="text-secondary text-sm font-medium uppercase tracking-widest">
                            Inspiración
                        </span>
                        <h2 className="font-heading text-4xl sm:text-5xl font-bold mt-3">
                            Galería <span className="gradient-text">LuzMágica</span>
                        </h2>
                        <p className="text-muted mt-4 max-w-xl mx-auto">
                            Inspírate con nuestras ideas de decoración LED para cada espacio de tu hogar.
                        </p>
                    </div>
                </FadeIn>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {galleryItems.map((item, i) => (
                        <FadeIn key={item.label} delay={i * 0.08}>
                            <motion.div
                                whileHover={{ scale: 1.03 }}
                                className={`relative aspect-square rounded-2xl overflow-hidden bg-gradient-to-br ${item.gradient} glass group cursor-pointer`}
                            >
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-6xl mb-3 group-hover:scale-110 transition-transform duration-500">
                                        {item.emoji}
                                    </span>
                                    <span className="text-sm text-muted font-medium opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                                        {item.label}
                                    </span>
                                </div>
                                {/* Hover overlay */}
                                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            </motion.div>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    );
}
