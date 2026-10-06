import { Suspense } from "react";
import ProductsClient from "./ProductsClient";
import { listPublishedProducts } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export const metadata = {
    title: "Productos | LuzMágica",
    description: "Explora nuestra colección completa de iluminación LED decorativa. Filtra por habitación, tipo y precio.",
};

export default async function ProductsPage() {
    const products = await listPublishedProducts();
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
