import { Suspense } from "react";
import ProductsClient from "./ProductsClient";
import productsData from "@/data/products.json";
import { Product } from "@/lib/types";

const products = productsData as Product[];

export const metadata = {
    title: "Productos | LuzMágica",
    description: "Explora nuestra colección completa de iluminación LED decorativa. Filtra por habitación, tipo y precio.",
};

export default function ProductsPage() {
    return (
        <Suspense fallback={
            <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
                <div className="animate-pulse text-muted">Cargando productos...</div>
            </div>
        }>
            <ProductsClient products={products} />
        </Suspense>
    );
}
