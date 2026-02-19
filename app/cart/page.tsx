import { Metadata } from "next";
import CartClient from "./CartClient";

export const metadata: Metadata = {
    title: "Carrito | LuzMágica",
    description: "Revisa tu carrito de compras en LuzMágica.",
};

export default function CartPage() {
    return <CartClient />;
}
