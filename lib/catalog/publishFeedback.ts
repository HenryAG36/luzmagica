import { isPlainObject } from "./validate.ts";

const MISSING_FIELD_LABELS: Record<string, string> = {
    name: "título",
    category: "categoría",
    room: "habitación",
    type: "tipo",
    description: "descripción",
    images: "imágenes permitidas",
    price_cop: "precio de venta",
    original_price_cop: "precio anterior",
    stock: "stock verificado",
    supplier_cost_cop: "costo proveedor",
    supplier_shipping_cop: "envío proveedor",
    taxes_fees_cop: "impuestos y tarifas",
    fx_rate: "tasa de cambio",
    fx_rate_date: "fecha de la tasa",
    supplier_rights_confirmed: "confirmación de derechos del proveedor",
};

const FALLBACK = "No se pudo publicar.";
const MAX_MESSAGE = 300;

function boundedMessage(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, MAX_MESSAGE);
    return trimmed || null;
}

export function describePublishError(body: unknown): string {
    if (!isPlainObject(body)) return FALLBACK;

    const missing = body.missing;
    if (missing !== undefined) {
        if (!Array.isArray(missing)) return FALLBACK;
        const labels = missing
            .filter((m): m is string => typeof m === "string" && m.length > 0)
            .map((m) => MISSING_FIELD_LABELS[m] ?? m.replace(/[^a-z_]/gi, "").slice(0, 40))
            .filter(Boolean);
        if (labels.length === 0) return FALLBACK;
        return `Faltan campos para publicar: ${labels.join(", ")}.`;
    }

    return boundedMessage(body.error) ?? FALLBACK;
}
