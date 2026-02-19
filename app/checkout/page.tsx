import { Metadata } from "next";
import CheckoutClient from "./CheckoutClient";

export const metadata: Metadata = {
    title: "Checkout | LuzMágica",
    description: "Completa tu pedido en LuzMágica.",
};

export default function CheckoutPage() {
    return <CheckoutClient />;
}
