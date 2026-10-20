// Shipping quotes are destination-specific: a quote confirmed for Medellín is
// not valid for Bogotá. City comparison normalizes accents, case, punctuation
// and the "Bogotá D.C." suffix so honest mismatches (and only those) block.

export function normalizeQuoteCity(value: string | null | undefined): string {
    const n = (value ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // U+0300–U+036F combining diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    return n === "bogotadc" ? "bogota" : n;
}

export function shippingQuoteMatchesCity(
    quote: string | null | undefined,
    destination: string | null | undefined
): boolean {
    const city = normalizeQuoteCity(destination);
    return city !== "" && city === normalizeQuoteCity(quote);
}
