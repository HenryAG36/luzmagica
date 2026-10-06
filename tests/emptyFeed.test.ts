import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEmptyFeed } from "../lib/trends/emptyFeed.ts";
import type { SourceStatus } from "../lib/trends/types.ts";

function status(partial: Partial<SourceStatus>): SourceStatus {
    return { source: "aliexpress_ds", status: "ok", ...partial };
}

test("empty feed message is source- and status-aware", () => {
    assert.equal(
        describeEmptyFeed("aliexpress_ds", status({ status: "ok" })),
        "Fuente activa, sin productos en la última respuesta del feed."
    );
    assert.equal(
        describeEmptyFeed("cjdropshipping", status({ status: "ok" })),
        "Fuente activa, sin productos en la última respuesta del proveedor."
    );
    assert.equal(
        describeEmptyFeed("mercadolibre", status({ status: "ok" })),
        "Fuente activa, sin datos en la última respuesta."
    );
    assert.equal(
        describeEmptyFeed("aliexpress_ds", status({ status: "disabled", message: "Conecta la app" })),
        "Conecta la app"
    );
    assert.equal(
        describeEmptyFeed("aliexpress_ds", status({ status: "error", message: "provider error 27" })),
        "La última actualización falló: provider error 27. Se conservan los datos anteriores si existen."
    );
    assert.equal(
        describeEmptyFeed("cjdropshipping", status({ status: "stale" })),
        "Sin datos recientes; los últimos datos disponibles pueden estar desactualizados."
    );
    assert.equal(
        describeEmptyFeed("aliexpress_ds", undefined),
        "Sin datos todavía; el estado de la fuente está pendiente."
    );
});
