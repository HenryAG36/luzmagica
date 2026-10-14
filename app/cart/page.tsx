import { Metadata } from "next";
import CartClient from "./CartClient";
import { listPublishedProducts } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Carrito | Honesty",
    description: "Revisa tu carrito de compras en Honesty.",
};

export default async function CartPage() {
    const products = await listPublishedProducts();
    return <CartClient catalogProducts={products} />;
}
