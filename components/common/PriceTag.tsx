import { formatCOP } from "@/lib/utils";

interface PriceTagProps {
    price: number;
    originalPrice?: number | null;
    quantity?: number;
    className?: string;
}

export default function PriceTag({
    price,
    originalPrice = null,
    quantity = 1,
    className = "",
}: PriceTagProps) {
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    const original =
        typeof originalPrice === "number" &&
        Number.isFinite(originalPrice) &&
        originalPrice > price &&
        price > 0
            ? originalPrice
            : null;
    const savingsUnit = original !== null ? original - price : 0;
    const percent = original !== null
        ? Math.round((savingsUnit / original) * 100)
        : 0;

    return (
        <div className={className}>
            <span className="font-semibold text-foreground">
                {formatCOP(price * qty)}
            </span>
            {savingsUnit > 0 && (
                <>
                    <span className="ml-2 text-sm text-muted line-through">
                        {formatCOP(original! * qty)}
                    </span>
                    <span className="ml-2 text-sm font-medium text-accent-dark">
                        Ahorras {formatCOP(savingsUnit * qty)}
                        {percent > 0 ? ` (-${percent}%)` : ""}
                    </span>
                </>
            )}
        </div>
    );
}
