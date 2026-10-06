import type { SourceStatus, TrendSource } from "./types.ts";

const OK_EMPTY: Partial<Record<TrendSource, string>> = {
    aliexpress_ds: "Fuente activa, sin productos en la última respuesta del feed.",
    cjdropshipping: "Fuente activa, sin productos en la última respuesta del proveedor.",
};

export function describeEmptyFeed(source: TrendSource, status: SourceStatus | undefined): string {
    if (!status) return "Sin datos todavía; el estado de la fuente está pendiente.";
    switch (status.status) {
        case "ok":
            return OK_EMPTY[source] ?? "Fuente activa, sin datos en la última respuesta.";
        case "disabled":
            return status.message ?? "Fuente no configurada.";
        case "error":
            return `La última actualización falló${status.message ? `: ${status.message}` : ""}. Se conservan los datos anteriores si existen.`;
        case "stale":
            return status.message
                ? `Sin datos recientes: ${status.message}.`
                : "Sin datos recientes; los últimos datos disponibles pueden estar desactualizados.";
    }
}
