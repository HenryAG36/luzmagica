"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import ProductCard from "@/components/products/ProductCard";
import FadeIn from "@/components/common/FadeIn";
import { Product } from "@/lib/types";
import { formatCOP } from "@/lib/utils";

const rooms = [
    { value: "", label: "Todas" },
    { value: "dormitorio", label: "Dormitorio" },
    { value: "sala", label: "Sala" },
    { value: "gaming", label: "Gaming" },
    { value: "cocina", label: "Cocina" },
];

const types = [
    { value: "", label: "Todos" },
    { value: "proyector", label: "Proyectores" },
    { value: "tira-led", label: "Tiras LED" },
    { value: "lampara", label: "Lámparas" },
    { value: "panel", label: "Paneles" },
    { value: "guirnalda", label: "Guirnaldas" },
];

const priceRanges = [
    { value: "", label: "Todos los precios" },
    { value: "0-50000", label: "Hasta $50.000" },
    { value: "50000-100000", label: "$50.000 - $100.000" },
    { value: "100000-200000", label: "Más de $100.000" },
];

interface ProductsClientProps {
    products: Product[];
}

export default function ProductsClient({ products }: ProductsClientProps) {
    const searchParams = useSearchParams();
    const initialRoom = searchParams.get("room") || "";

    const [selectedRoom, setSelectedRoom] = useState(initialRoom);
    const [selectedType, setSelectedType] = useState("");
    const [selectedPrice, setSelectedPrice] = useState("");
    const [showFilters, setShowFilters] = useState(false);

    const filtered = useMemo(() => {
        return products.filter((p) => {
            if (selectedRoom && p.room !== selectedRoom) return false;
            if (selectedType && p.type !== selectedType) return false;
            if (selectedPrice) {
                const [min, max] = selectedPrice.split("-").map(Number);
                if (p.price < min || p.price > max) return false;
            }
            return true;
        });
    }, [products, selectedRoom, selectedType, selectedPrice]);

    const hasFilters = selectedRoom || selectedType || selectedPrice;

    const clearFilters = () => {
        setSelectedRoom("");
        setSelectedType("");
        setSelectedPrice("");
    };

    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <FadeIn>
                    <div className="mb-12">
                        <h1 className="font-heading text-4xl sm:text-5xl font-bold">
                            Nuestros <span className="gradient-text">Productos</span>
                        </h1>
                        <p className="text-muted mt-3 max-w-xl">
                            Encuentra la iluminación perfecta para cada rincón de tu hogar.
                        </p>
                    </div>
                </FadeIn>

                {/* Filter toggle - mobile */}
                <div className="mb-6 md:hidden">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass text-sm text-muted hover:text-white transition-colors"
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Filtros
                        {hasFilters && (
                            <span className="w-2 h-2 rounded-full bg-primary" />
                        )}
                    </button>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                    {/* Filters sidebar */}
                    <motion.aside
                        initial={false}
                        animate={{
                            height: showFilters ? "auto" : 0,
                            opacity: showFilters ? 1 : 0,
                        }}
                        className={`md:!h-auto md:!opacity-100 overflow-hidden md:overflow-visible md:w-64 flex-shrink-0`}
                    >
                        <div className="glass rounded-2xl p-6 space-y-6 sticky top-28">
                            <div className="flex items-center justify-between">
                                <h3 className="font-heading font-semibold text-white">Filtros</h3>
                                {hasFilters && (
                                    <button
                                        onClick={clearFilters}
                                        className="text-xs text-primary hover:text-primary-light flex items-center gap-1"
                                    >
                                        <X className="w-3 h-3" />
                                        Limpiar
                                    </button>
                                )}
                            </div>

                            {/* Room filter */}
                            <div>
                                <label className="text-sm text-muted mb-2 block">Habitación</label>
                                <div className="flex flex-wrap gap-2">
                                    {rooms.map((room) => (
                                        <button
                                            key={room.value}
                                            onClick={() => setSelectedRoom(room.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs transition-all ${selectedRoom === room.value
                                                    ? "bg-primary text-white"
                                                    : "glass text-muted hover:text-white"
                                                }`}
                                        >
                                            {room.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Type filter */}
                            <div>
                                <label className="text-sm text-muted mb-2 block">Tipo</label>
                                <div className="flex flex-wrap gap-2">
                                    {types.map((type) => (
                                        <button
                                            key={type.value}
                                            onClick={() => setSelectedType(type.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs transition-all ${selectedType === type.value
                                                    ? "bg-primary text-white"
                                                    : "glass text-muted hover:text-white"
                                                }`}
                                        >
                                            {type.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Price filter */}
                            <div>
                                <label className="text-sm text-muted mb-2 block">Precio</label>
                                <div className="flex flex-col gap-2">
                                    {priceRanges.map((range) => (
                                        <button
                                            key={range.value}
                                            onClick={() => setSelectedPrice(range.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs text-left transition-all ${selectedPrice === range.value
                                                    ? "bg-primary text-white"
                                                    : "glass text-muted hover:text-white"
                                                }`}
                                        >
                                            {range.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.aside>

                    {/* Product grid */}
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-6">
                            <span className="text-sm text-muted">
                                {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
                            </span>
                        </div>

                        {filtered.length === 0 ? (
                            <div className="text-center py-20">
                                <p className="text-4xl mb-4">🔍</p>
                                <p className="text-muted">No se encontraron productos con estos filtros.</p>
                                <button
                                    onClick={clearFilters}
                                    className="mt-4 text-primary hover:text-primary-light text-sm"
                                >
                                    Limpiar filtros
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filtered.map((product, i) => (
                                    <ProductCard key={product.id} product={product} index={i} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
