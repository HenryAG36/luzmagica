"use client";

import Hero from "@/components/home/Hero";
import OrderAgainSection from "@/components/retention/OrderAgainSection";
import CategoryGrid from "@/components/home/CategoryGrid";
import FeaturedCarousel from "@/components/home/FeaturedCarousel";
import Benefits from "@/components/home/Benefits";
import { Product } from "@/lib/types";

interface HomeClientProps {
    products: Product[];
}

export default function HomeClient({ products }: HomeClientProps) {
    return (
        <>
            <Hero />
            <OrderAgainSection />
            <CategoryGrid products={products} />
            <FeaturedCarousel products={products} />
            <Benefits />
        </>
    );
}
