import ProductDetailClient from "./ProductDetailClient";
import productsData from "@/data/products.json";
import { Product } from "@/lib/types";
import { notFound } from "next/navigation";

const products = productsData as Product[];

interface Props {
    params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
    return products.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    const product = products.find((p) => p.id === id);
    if (!product) return { title: "Producto no encontrado" };

    return {
        title: `${product.name} | LuzMágica`,
        description: product.description,
    };
}

export default async function ProductDetailPage({ params }: Props) {
    const { id } = await params;
    const product = products.find((p) => p.id === id);

    if (!product) notFound();

    const related = products
        .filter((p) => p.room === product.room && p.id !== product.id)
        .slice(0, 4);

    return <ProductDetailClient product={product} related={related} />;
}
