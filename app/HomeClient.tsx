"use client";

import Hero from "@/components/home/Hero";
import RoomGrid from "@/components/home/RoomGrid";
import FeaturedCarousel from "@/components/home/FeaturedCarousel";
import Benefits from "@/components/home/Benefits";
import Gallery from "@/components/home/Gallery";
import { Product } from "@/lib/types";

interface HomeClientProps {
    products: Product[];
}

export default function HomeClient({ products }: HomeClientProps) {
    return (
        <>
            <Hero />
            <RoomGrid />
            <FeaturedCarousel products={products} />
            <Benefits />
            <Gallery />
        </>
    );
}
