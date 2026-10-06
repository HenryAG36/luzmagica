"use client";

import { useState } from "react";
import { formatCOP } from "@/lib/utils";
import {
    computeActualContribution,
    computePriceSuggestion,
    parseCopInput,
    parsePercentInput,
} from "@/lib/catalog/pricing";

export interface PricingFieldsState {
    priceCop: string;
    supplierCostCop: string;
    shippingCop: string;
    taxesFeesCop: string;
    paymentFeePercent: string;
    customerShippingCop: string;
    shippingCity: string;
    shippingCheckedAt: string;
}

const inputClass =
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary";

export default function PricingControls({
    value,
    onChange,
    listingPrice,
    listingCurrency,
    listingCostCop,
}: {
    value: PricingFieldsState;
    onChange: (patch: Partial<PricingFieldsState>) => void;
    listingPrice?: number | null;
    listingCurrency?: string | null;
    // caller computes usdToCop(listingPrice, fxRate) — only provided when the
    // listing currency is USD and a positive FX rate with a date was entered
    listingCostCop?: number | null;
}) {
    const [margin, setMargin] = useState(15);

    const supplierCost = parseCopInput(value.supplierCostCop);
    const supplierShipping = parseCopInput(value.shippingCop);
    const taxes = parseCopInput(value.taxesFeesCop);
    const payment = parsePercentInput(value.paymentFeePercent);
    const price = parseCopInput(value.priceCop);

    // a non-blank field that fails to parse is invalid input, not "unknown":
    // suppress the suggestion rather than compute with a wrong silent null
    const taxesInvalid = value.taxesFeesCop.trim() !== "" && taxes === null;
    const paymentInvalid =
        value.paymentFeePercent.trim() !== "" && (payment === null || payment > 20);

    const suggestion =
        !taxesInvalid && !paymentInvalid && supplierCost !== null && supplierShipping !== null
            ? computePriceSuggestion({
                  supplierCostCop: supplierCost,
                  shippingCop: supplierShipping,
                  taxesFeesCop: taxes,
                  paymentFeePercent: payment,
                  targetMarginPercent: margin,
              })
            : null;
    const actualContribution =
        price !== null && supplierCost !== null
            ? computeActualContribution(price, supplierCost)
            : null;

    const applySuggestion = () => {
        if (!suggestion) return;
        const shipChanged =
            String(suggestion.customerShipping) !== value.customerShippingCop.trim();
        onChange({
            priceCop: String(suggestion.customerProduct),
            customerShippingCop: String(suggestion.customerShipping),
            // a changed shipping quote voids the previous confirmation date
            ...(shipChanged ? { shippingCheckedAt: "" } : {}),
        });
    };

    return (
        <div className="rounded-xl border border-white/10 p-3 space-y-3">
            <p className="text-[11px] font-semibold text-white">Costos, envío y precio</p>

            {listingPrice != null && (
                <p className="text-[10px] text-muted">
                    Precio de lista del proveedor: {listingPrice} {listingCurrency ?? "moneda desconocida"}.
                    {listingCostCop != null ? (
                        <>
                            {" "}
                            <button
                                type="button"
                                onClick={() => onChange({ supplierCostCop: String(listingCostCop) })}
                                className="text-primary hover:underline"
                            >
                                Usar precio de lista como costo (confirmado)
                            </button>
                        </>
                    ) : (
                        " El costo real se ingresa manualmente; la lista no se convierte sola."
                    )}
                </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-[11px] text-muted block mb-1">Costo proveedor COP</label>
                    <input
                        type="number"
                        min={0}
                        value={value.supplierCostCop}
                        onChange={(e) => onChange({ supplierCostCop: e.target.value })}
                        className={inputClass}
                    />
                </div>
                <div>
                    <label className="text-[11px] text-muted block mb-1">Envío proveedor COP</label>
                    <input
                        type="number"
                        min={0}
                        value={value.shippingCop}
                        onChange={(e) => onChange({ shippingCop: e.target.value })}
                        className={inputClass}
                    />
                </div>
                <div>
                    <label className="text-[11px] text-muted block mb-1">Impuestos y tarifas COP (opcional)</label>
                    <input
                        type="number"
                        min={0}
                        value={value.taxesFeesCop}
                        onChange={(e) => onChange({ taxesFeesCop: e.target.value })}
                        className={inputClass}
                    />
                    {taxesInvalid && (
                        <p className="text-[10px] text-red-300 mt-1">Valor inválido: no hay sugerencia.</p>
                    )}
                </div>
                <div>
                    <label className="text-[11px] text-muted block mb-1">Comisión de pasarela % (opcional)</label>
                    <input
                        type="number"
                        min={0}
                        max={20}
                        step="0.1"
                        value={value.paymentFeePercent}
                        onChange={(e) => onChange({ paymentFeePercent: e.target.value })}
                        placeholder="No se guarda; ajusta la sugerencia"
                        className={inputClass}
                    />
                    {paymentInvalid && (
                        <p className="text-[10px] text-red-300 mt-1">Valor inválido (0–20): no hay sugerencia.</p>
                    )}
                </div>
            </div>

            <div>
                <label className="text-[11px] text-muted block mb-1">
                    Margen de contribución objetivo: {margin}%
                </label>
                <input
                    type="range"
                    min={15}
                    max={50}
                    step={1}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                    className="w-full accent-primary"
                />
            </div>

            {suggestion !== null && (
                <div className="space-y-1">
                    <p className="text-[10px] text-muted">
                        Sugerencia a {margin}%: producto {formatCOP(suggestion.customerProduct)} + envío{" "}
                        {formatCOP(suggestion.customerShipping)} = {formatCOP(suggestion.total)} · contribución{" "}
                        {formatCOP(suggestion.contributionCop)}.
                        {suggestion.provisional &&
                            " Provisional: impuestos y/o comisión de pasarela desconocidos no incluidos."}
                    </p>
                    <button
                        type="button"
                        onClick={applySuggestion}
                        className="px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors"
                    >
                        Aplicar sugerencia a precio y envío al cliente
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-[11px] text-muted block mb-1">
                        Envío al cliente COP (vacío = pendiente · 0 = gratis confirmado)
                    </label>
                    <input
                        type="number"
                        min={0}
                        value={value.customerShippingCop}
                        onChange={(e) =>
                            onChange({ customerShippingCop: e.target.value, shippingCheckedAt: "" })
                        }
                        className={inputClass}
                    />
                    <button
                        type="button"
                        disabled={supplierShipping === null}
                        onClick={() =>
                            onChange({
                                customerShippingCop: String(supplierShipping),
                                shippingCheckedAt: "",
                            })
                        }
                        className="mt-1 text-[10px] text-primary hover:underline disabled:opacity-40"
                    >
                        Usar el envío del proveedor como envío al cliente (sin recargo)
                    </button>
                </div>
                <div>
                    <label className="text-[11px] text-muted block mb-1">Ciudad de la cotización de envío</label>
                    <input
                        value={value.shippingCity}
                        onChange={(e) =>
                            onChange({ shippingCity: e.target.value, shippingCheckedAt: "" })
                        }
                        placeholder="Ej: Bogotá"
                        className={inputClass}
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] text-muted">
                    Cotización verificada:{" "}
                    {value.shippingCheckedAt
                        ? new Date(value.shippingCheckedAt).toLocaleString("es-CO")
                        : "sin confirmar"}
                </p>
                <button
                    type="button"
                    onClick={() => onChange({ shippingCheckedAt: new Date().toISOString() })}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[10px] text-white hover:bg-white/10 transition-colors"
                >
                    Confirmar verificación ahora
                </button>
            </div>
            <p className="text-[10px] text-muted">
                La fecha de verificación solo se registra al confirmar manualmente; no se consulta ninguna API.
            </p>

            {actualContribution !== null && (
                <p className={`text-[10px] font-mono ${actualContribution >= 0 ? "text-green-400" : "text-red-400"}`}>
                    Diferencia producto/costo: {formatCOP(actualContribution)} (no incluye saldo de envío,
                    impuestos ni comisiones).
                </p>
            )}
        </div>
    );
}
