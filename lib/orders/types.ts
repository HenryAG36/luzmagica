export type PaymentStatus =
    | "pending_payment"
    | "paid"
    | "payment_failed"
    | "payment_review"
    | "cancelled"
    | "refunded";

export type FulfillmentStatus =
    | "awaiting_payment"
    | "payment_confirmed"
    | "supplier_processing"
    | "international_transit"
    | "customs_cleared"
    | "local_delivery"
    | "delivered"
    | "cancelled";

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
    awaiting_payment: "Esperando pago",
    payment_confirmed: "Pago confirmado",
    supplier_processing: "Procesando con proveedor",
    international_transit: "Tránsito internacional",
    customs_cleared: "Liberado de aduana",
    local_delivery: "En reparto local",
    delivered: "Entregado",
    cancelled: "Cancelado",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
    pending_payment: "Pago pendiente",
    paid: "Pagado",
    payment_failed: "Pago fallido",
    payment_review: "Revisión de pago",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
};

export interface OrderCustomer {
    name: string;
    email: string;
    phone: string;
    cedula: string;
    address: string;
    city: string;
    department: string | null;
    notes: string | null;
}

export interface OrderItemInput {
    productId: string;
    quantity: number;
}

export interface PricedItem {
    productId: string;
    name: string;
    unitPriceCop: number;
    quantity: number;
    unitShippingCop: number;
    unitSupplierCostCop: number | null;
    source: string;
    supplierVariant: Record<string, unknown> | null;
}

export interface OrderPricing {
    items: PricedItem[];
    subtotalCop: number;
    discountCop: number;
    shippingCop: number;
    totalCop: number;
    couponCode: string | null;
}

export interface OrderRow {
    id: string;
    ref: string;
    lookup_token: string;
    cart_fingerprint: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    customer_cedula: string;
    address: string;
    city: string;
    department: string | null;
    notes: string | null;
    subtotal_cop: number;
    discount_cop: number;
    shipping_cop: number;
    total_cop: number;
    coupon_code: string | null;
    payment_status: PaymentStatus;
    fulfillment_status: FulfillmentStatus;
    payment_link_id: string | null;
    payment_link_url: string | null;
    wompi_transaction_id: string | null;
    tracking_number: string | null;
    carrier: string | null;
    supplier_order_id: string | null;
    supplier_order_status: string | null;
    supplier_order_error: string | null;
    supplier_order_placed_at: string | null;
    supplier_synced_at: string | null;
    auto_fulfill_attempts: number;
    review: { rating: number; comment: string; date: string } | null;
    consent_at: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface OrderItemRow {
    id: number;
    order_id: string;
    product_id: string;
    name: string;
    unit_price_cop: number;
    quantity: number;
    unit_shipping_cop: number;
    unit_supplier_cost_cop: number | null;
    source: string;
    supplier_variant: Record<string, unknown> | null;
}

export interface OrderEventRow {
    id: number;
    order_id: string;
    kind: "payment" | "fulfillment" | "note";
    status: string;
    label: string;
    description: string;
    created_at: string;
}

export interface PublicOrderItem {
    productId: string;
    name: string;
    unitPriceCop: number;
    quantity: number;
    unitShippingCop: number;
}

export interface PublicOrderEvent {
    status: string;
    label: string;
    description: string;
    timestamp: string;
}

export interface PublicOrder {
    ref: string;
    createdAt: string;
    city: string;
    paymentStatus: PaymentStatus;
    fulfillmentStatus: FulfillmentStatus;
    items: PublicOrderItem[];
    subtotalCop: number;
    discountCop: number;
    shippingCop: number;
    totalCop: number;
    trackingNumber: string | null;
    carrier: string | null;
    events: PublicOrderEvent[];
    reviewedProductIds: string[];
    claims: PublicClaim[];
}

export type ClaimReason = "defective" | "damaged" | "wrong_item" | "not_received" | "other";

export const CLAIM_REASONS: ClaimReason[] = [
    "defective",
    "damaged",
    "wrong_item",
    "not_received",
    "other",
];

export const CLAIM_REASON_LABELS: Record<ClaimReason, string> = {
    defective: "Producto defectuoso",
    damaged: "Llegó dañado",
    wrong_item: "Producto equivocado",
    not_received: "No llegó",
    other: "Otro motivo",
};

export type ClaimStatus =
    | "draft"
    | "submitted"
    | "provider_responded"
    | "resolved"
    | "rejected"
    | "cancelled";

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
    draft: "En revisión",
    submitted: "Enviada al proveedor",
    provider_responded: "Proveedor respondió",
    resolved: "Resuelta",
    rejected: "Rechazada",
    cancelled: "Cancelada",
};

export interface PublicClaim {
    productId: string;
    reason: ClaimReason;
    status: ClaimStatus;
}

export interface SupplierClaimRow {
    id: string;
    order_id: string;
    order_item_id: number;
    provider: string;
    reason: ClaimReason;
    description: string;
    evidence_paths: string[];
    status: ClaimStatus;
    provider_dispute_id: string | null;
    provider_status: string | null;
    notes: string | null;
    created_by: "customer" | "operator";
    created_at: string;
    updated_at: string;
}

export interface RefundRequestRow {
    id: string;
    order_id: string;
    amount_cop: number;
    reason: string;
    status: "requested" | "void_attempted" | "manual_required" | "completed" | "failed";
    wompi_void_result: Record<string, unknown> | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface ProductReviewRow {
    id: string;
    product_id: string;
    order_id: string;
    rating: number;
    comment: string;
    reviewer_name: string | null;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    updated_at: string;
}

export interface PublicReview {
    rating: number;
    comment: string;
    reviewerName: string;
    createdAt: string;
}
