export interface Product {
    id: string;
    name: string;
    price: number;
    originalPrice: number | null;
    category: string;
    room: string;
    images: string[];
    badge: "sale" | "new" | null;
    description: string;
    stock: number;
    type: string;
}

export interface CartItem {
    product: Product;
    quantity: number;
}
