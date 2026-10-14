import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import CartDrawer from "@/components/cart/CartDrawer";
import LoyaltyModal from "@/components/loyalty/LoyaltyModal";
import AuthInitializer from "@/components/auth/AuthInitializer";
import ExitIntentRecoveryModal from "@/components/retention/ExitIntentRecoveryModal";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Honesty | Tienda Premium",
  description:
    "Encuentra de todo al mejor precio: pago seguro con Nequi, PSE y tarjetas vía Wompi, y envíos cotizados de forma transparente antes de pagar.",
  keywords: "tienda online, Colombia, ofertas, compras seguras, Honesty",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${inter.variable} ${cormorant.variable} antialiased bg-background text-foreground font-body`}
      >
        <AuthInitializer />
        <header className="sticky top-0 z-40">
          <AnnouncementBar />
          <Navbar />
        </header>
        <main className="min-h-screen">{children}</main>
        <Footer />
        <CartDrawer />
        <LoyaltyModal />
        <ExitIntentRecoveryModal />
      </body>
    </html>
  );
}
