import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import LoyaltyModal from "@/components/loyalty/LoyaltyModal";
import AuthInitializer from "@/components/auth/AuthInitializer";
import ExitIntentRecoveryModal from "@/components/retention/ExitIntentRecoveryModal";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "LuzMágica | Iluminación LED Decorativa con Garantía en Colombia",
  description:
    "Descubre la colección más exclusiva de iluminación LED decorativa. Proyectores, tiras LED, lámparas 3D y paneles. Envíos asegurados y puntos LuzClub.",
  keywords: "LED, iluminación, decoración, hogar, Colombia, luces decorativas, LuzMágica, dropshipping de confianza",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground font-body`}
      >
        <AuthInitializer />
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <Footer />
        <LoyaltyModal />
        <ExitIntentRecoveryModal />
      </body>
    </html>
  );
}
