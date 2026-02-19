import HomeClient from "./HomeClient";
import productsData from "@/data/products.json";
import { Product } from "@/lib/types";

const products = productsData as Product[];

export default function Home() {
  return <HomeClient products={products} />;
}
