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

export interface DsFreightOption {
    code: string | null;
    company: string | null;
    feeUsd: number | null;
    feeCurrency: string | null;
    feeLabel: string | null;
    minDays: number | null;
    maxDays: number | null;
    availableStock: number | null;
    freeShipping: boolean;
    ddpIncludesVatTax: boolean;
}

export interface DsFreightQuote {
    productId: string;
    skuId: string;
    options: DsFreightOption[];
    destination: string;
    quantity: number;
    checkedAt: string;
}
