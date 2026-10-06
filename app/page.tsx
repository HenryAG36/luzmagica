import HomeClient from "./HomeClient";
import { listPublishedProducts } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const products = await listPublishedProducts();
  return <HomeClient products={products} />;
}
