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
    supplierCostCOP?: number; // Dropshipping wholesale cost
    shippingEstimateCOP?: number | null;
    shippingEstimateCity?: string | null;
    shippingCheckedAt?: string | null;
    shippingQuoteRequired?: boolean;
}

export interface CartItem {
    product: Product;
    quantity: number;
}

export interface CustomerProfile {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    department?: string;
    cedula: string;
    notes?: string;
}

export type UserRole = "customer" | "admin";

export interface UserAccount {
    id: string;
    email: string;
    role: UserRole;
    name: string;
    phone: string;
    cedula: string;
    address: string;
    city: string;
    department?: string;
    createdAt: string;
}

export type LoyaltyTier = "bronce" | "plata" | "oro" | "galactico";

export interface PointsTransaction {
    id: string;
    date: string;
    points: number;
    reason: string;
    type: "earned" | "redeemed";
}

export interface LoyaltyAccount {
    points: number;
    lifetimePoints: number;
    tier: LoyaltyTier;
    referralCode: string;
    history: PointsTransaction[];
}

export interface AbandonedCart {
    id: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    items: CartItem[];
    total: number;
    createdAt: string;
    recoveryCode: string;
    discountPercent: number;
    status: "pending" | "recovered" | "expired";
    lastContactedAt?: string;
}

export interface Review {
    id: string;
    productId: string;
    productName: string;
    author: string;
    city: string;
    rating: number;
    comment: string;
    date: string;
    verifiedBuyer: boolean;
}

export interface OperatorTask {
    id: string;
    type: "fulfill_order" | "whatsapp_recovery" | "low_stock" | "review_moderation";
    title: string;
    description: string;
    priority: "high" | "medium" | "low";
    actionLabel: string;
    actionTarget: string;
    completed: boolean;
}
