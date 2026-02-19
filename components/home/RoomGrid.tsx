"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import FadeIn from "@/components/common/FadeIn";

const rooms = [
    {
        name: "Dormitorio",
        slug: "dormitorio",
        emoji: "🌙",
        description: "Crea un ambiente de ensueño",
        gradient: "from-purple-900/40 to-indigo-900/40",
    },
    {
        name: "Sala de Estar",
        slug: "sala",
        emoji: "🛋️",
        description: "Iluminación que inspira",
        gradient: "from-cyan-900/40 to-blue-900/40",
    },
    {
        name: "Gaming Room",
        slug: "gaming",
        emoji: "🎮",
        description: "RGB para tu setup perfecto",
        gradient: "from-pink-900/40 to-purple-900/40",
    },
    {
        name: "Cocina",
        slug: "cocina",
        emoji: "✨",
        description: "Luces cálidas y funcionales",
        gradient: "from-amber-900/40 to-orange-900/40",
    },
];

export default function RoomGrid() {
    return (
        <section id="rooms" className="py-24 px-4">
            <div className="max-w-7xl mx-auto">
                <FadeIn>
                    <div className="text-center mb-16">
                        <span className="text-secondary text-sm font-medium uppercase tracking-widest">
                            Explora por espacio
                        </span>
                        <h2 className="font-heading text-4xl sm:text-5xl font-bold mt-3">
                            Shop by <span className="gradient-text">Room</span>
                        </h2>
                    </div>
                </FadeIn>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {rooms.map((room, i) => (
                        <FadeIn key={room.slug} delay={i * 0.1}>
                            <Link href={`/products?room=${room.slug}`}>
                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    className={`relative h-64 sm:h-72 rounded-3xl overflow-hidden bg-gradient-to-br ${room.gradient} glass group cursor-pointer`}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />

                                    {/* Hover glow */}
                                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                                        <div className="absolute inset-0 bg-primary/5" />
                                    </div>

                                    {/* Content */}
                                    <div className="relative z-10 h-full flex flex-col justify-end p-8">
                                        <span className="text-4xl mb-3">{room.emoji}</span>
                                        <h3 className="font-heading text-2xl font-bold text-white group-hover:text-primary transition-colors">
                                            {room.name}
                                        </h3>
                                        <p className="text-muted text-sm mt-1">{room.description}</p>
                                        <div className="mt-4 flex items-center gap-2 text-sm text-primary opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                                            <span>Ver productos</span>
                                            <span>→</span>
                                        </div>
                                    </div>
                                </motion.div>
                            </Link>
                        </FadeIn>
                    ))}
                </div>
            </div>
        </section>
    );
}
