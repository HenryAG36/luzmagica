// Supplier sourcing policy. AliExpress and CJ remain trend/statistics sources
// only — no new imports or purchases are created from them. Mastershop is the
// only importable supplier while its contract is active.

export const RESEARCH_ONLY_SOURCES = new Set(["aliexpress", "aliexpress_ds", "cjdropshipping"]);

export const RESEARCH_ONLY_MESSAGE =
    "AliExpress y CJ son fuentes de investigación; la importación y los pedidos están deshabilitados.";

export const IMPORTABLE_SUPPLIER_SOURCES = new Set(["mastershop"]);

// Sources whose products require an explicit confirmed customer shipping
// quote before publish/checkout. null is never treated as free shipping.
export const QUOTED_SHIPPING_SOURCES = new Set(["mastershop"]);

export const MASTERSHOP_PREPAID_MANUAL_MESSAGE =
    "Mastershop: pedido prepagado requiere gestión manual; no se enviará como contraentrega.";

// Sources with no automatic provider order API are parked as failed+manual.
// The flag clears when the operator records a real tracking number and
// carrier. (The only automated path is Mastershop COD submission behind
// MASTERSHOP_COD_ENABLED.)
export const MANUAL_FULFILLMENT_MESSAGES = new Set([
    RESEARCH_ONLY_MESSAGE,
    MASTERSHOP_PREPAID_MANUAL_MESSAGE,
]);
