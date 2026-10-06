import ProductDetailClient from "./ProductDetailClient";
import { getPublishedProduct, listPublishedRelated } from "@/lib/catalog/repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
    params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    const product = await getPublishedProduct(id);
    if (!product) return { title: "Producto no encontrado" };

    return {
        title: `${product.name} | LuzMágica`,
        description: product.description,
    };
}

export default async function ProductDetailPage({ params }: Props) {
    const { id } = await params;
    const product = await getPublishedProduct(id);

    if (!product) notFound();

    const related = await listPublishedRelated(product.room, product.id);

    return <ProductDetailClient product={product} related={related} />;
}
