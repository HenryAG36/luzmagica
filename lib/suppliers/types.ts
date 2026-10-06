export interface DsSku {
    skuId: string;
    skuAttr: string | null;
    offerSalePrice: number | null;
    skuPrice: number | null;
    currency: string | null;
    availableStock: number | null;
}

export interface DsProduct {
    productId: string;
    title: string;
    descriptionText: string;
    categoryId: string | null;
    currency: string | null;
    providerReportedSales: number | null;
    images: string[];
    skus: DsSku[];
    deliveryTimeDays: number | null;
    sourceUrl: string;
}
