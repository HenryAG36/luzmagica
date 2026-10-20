"use client";

import { useEffect, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    Copy,
    ExternalLink,
    Link2,
    RefreshCw,
    Wrench,
} from "lucide-react";
import type { SourceStatus } from "@/lib/trends/types";
import type { DsFeedInfo } from "@/lib/suppliers/aliexpressDs";

interface Props {
    statuses: SourceStatus[];
    onRefresh: () => void;
    dsConnectResult: string | null;
}

const inputClass =
    "w-full px-3 py-2 rounded-xl bg-surface-card border border-black/10 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-primary";

function statusLine(status: SourceStatus | undefined, label: string) {
    if (!status) return <span className="text-muted">{label}: sin datos recientes.</span>;
    if (status.status === "ok")
        return (
            <span className="text-success">
                {label}: OK
                {status.fetchedAt ? ` · actualizado ${new Date(status.fetchedAt).toLocaleString("es-CO")}` : ""}
            </span>
        );
    if (status.status === "disabled")
        return <span className="text-muted">{label}: deshabilitado — {status.message ?? "sin credenciales configuradas"}</span>;
    if (status.status === "stale")
        return <span className="text-warning">{label}: datos antiguos — {status.message ?? "requiere refresco"}</span>;
    return (
        <span className="text-danger">
            {label}: error — {status.message ?? "desconocido"}
        </span>
    );
}

interface MastershopStatus {
    configured: boolean;
    country: string;
    catalog: boolean;
    automaticOrders: boolean;
    shippingQuotes: boolean;
    tracking: boolean;
    cashOnDelivery: boolean;
}

export default function SupplierConnectionsPanel({ statuses, onRefresh, dsConnectResult }: Props) {
    const [mastershopStatus, setMastershopStatus] = useState<MastershopStatus | null>(null);
    const [mastershopStatusError, setMastershopStatusError] = useState("");
    const [mastershopVerified, setMastershopVerified] = useState<boolean | null>(null);
    const [mastershopProbing, setMastershopProbing] = useState(false);
    const [dsFeeds, setDsFeeds] = useState<DsFeedInfo[]>([]);
    const [dsFeedChoice, setDsFeedChoice] = useState("");
    const [dsFeedsBusy, setDsFeedsBusy] = useState(false);
    const [dsDiag, setDsDiag] = useState<string | null>(null);
    const [dsDiagBusy, setDsDiagBusy] = useState(false);
    const [dsDiagCopied, setDsDiagCopied] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // Mastershop config status — fetched once on mount (StrictMode-safe: the
    // effect's own cleanup aborts the obsolete request, the reissued one
    // completes). Catalog access is only claimed after an explicit
    // "Probar acceso" probe succeeds.
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        void (async () => {
            try {
                const res = await fetch("/api/admin/suppliers/mastershop/status", {
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error("No se pudo consultar la configuración de Mastershop.");
                const body = (await res.json()) as MastershopStatus;
                if (active) setMastershopStatus(body);
            } catch (e) {
                if (active && !controller.signal.aborted) {
                    setMastershopStatusError(
                        e instanceof Error ? e.message : "No se pudo consultar la configuración de Mastershop."
                    );
                }
            }
        })();
        return () => {
            active = false;
            controller.abort();
        };
    }, []);

    // Probes the protected catalog query — a successful request (even an empty
    // page) proves access for this session only. Never reads or shows the key.
    const probeMastershopAccess = async () => {
        setMastershopProbing(true);
        setError("");
        try {
            const res = await fetch("/api/admin/suppliers/mastershop/products?offset=0");
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMastershopVerified(false);
                setError(body.error || "Mastershop no respondió al acceso de prueba.");
                return;
            }
            setMastershopVerified(true);
            setNotice(`Acceso Mastershop verificado (${Array.isArray(body.products) ? body.products.length : 0} productos listados).`);
        } catch {
            setMastershopVerified(false);
            setError("Error de red al probar el acceso Mastershop.");
        } finally {
            setMastershopProbing(false);
        }
    };

    const dsStatus = statuses.find((s) => s.source === "aliexpress_ds");
    const cjStatus = statuses.find((s) => s.source === "cjdropshipping");
    const meliStatus = statuses.find((s) => s.source === "mercadolibre");
    const affiliateStatus = statuses.find((s) => s.source === "aliexpress");

    const dsResultMessage = dsConnectResult
        ? ({
              connected: ["AliExpress DS conectado correctamente.", true],
              exchange_failed: ["No se pudo completar la conexión con AliExpress DS.", false],
              persist_failed: ["La conexión DS no se pudo guardar. Intenta de nuevo.", false],
              connection_busy: ["Otra operación DS está en curso. Intenta de nuevo.", false],
          }[dsConnectResult] ?? ["No se pudo conectar AliExpress DS. Vuelve a intentarlo.", false])
        : null;

    const loadDsFeeds = async () => {
        setDsFeedsBusy(true);
        setError("");
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/feeds");
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudieron cargar los feeds.");
                return;
            }
            setDsFeeds(Array.isArray(body.feeds) ? body.feeds : []);
            setDsFeedChoice(typeof body.selectedFeed === "string" ? body.selectedFeed : "");
        } catch {
            setError("Error de red al cargar los feeds.");
        } finally {
            setDsFeedsBusy(false);
        }
    };

    const saveDsFeed = async () => {
        if (!dsFeedChoice) return;
        setDsFeedsBusy(true);
        setError("");
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/feeds", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ feedName: dsFeedChoice }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo guardar el feed.");
                return;
            }
            setNotice(`Feed DS seleccionado: ${body.selectedFeed}.`);
            onRefresh();
        } catch {
            setError("Error de red al guardar el feed.");
        } finally {
            setDsFeedsBusy(false);
        }
    };

    const runDsDiagnostics = async () => {
        setDsDiagBusy(true);
        setDsDiag(null);
        setDsDiagCopied(false);
        setError("");
        try {
            const res = await fetch("/api/admin/suppliers/aliexpress-ds/diagnostics", {
                method: "POST",
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body.error || "No se pudo ejecutar el diagnóstico.");
                return;
            }
            setDsDiag(JSON.stringify(body.diagnostics, null, 2));
        } catch {
            setError("Error de red al ejecutar el diagnóstico.");
        } finally {
            setDsDiagBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            {dsResultMessage && (
                <div
                    className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 border ${
                        dsResultMessage[1]
                            ? "bg-green-500/15 border-success/30 text-success"
                            : "bg-red-500/15 border-danger/30 text-danger"
                    }`}
                >
                    {dsResultMessage[1] ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{dsResultMessage[0]}</span>
                </div>
            )}
            {error && (
                <div role="alert" className="p-3.5 rounded-2xl bg-red-500/15 border border-danger/30 text-danger text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {notice && (
                <div className="p-3.5 rounded-2xl bg-green-500/15 border border-success/30 text-success text-xs flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{notice}</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Mastershop — the only importable supplier */}
                <div className="glass rounded-3xl p-6 space-y-3">
                    <h4 className="font-heading text-base font-bold text-foreground flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-accent-dark" />
                        Mastershop
                    </h4>
                    <p className="text-[11px]">
                        {mastershopStatus === null ? (
                            mastershopStatusError ? (
                                <span role="alert" className="text-danger">
                                    Estado: {mastershopStatusError}
                                </span>
                            ) : (
                                <span className="text-muted">Estado: consultando configuración…</span>
                            )
                        ) : mastershopStatus.configured ? (
                            <span className={mastershopVerified === true ? "text-success" : "text-warning"}>
                                {mastershopVerified === true
                                    ? "Clave configurada · acceso verificado"
                                    : "Clave configurada · acceso pendiente de verificación"}
                            </span>
                        ) : (
                            <span className="text-danger">Falta MASTERSHOP_API_KEY en el servidor.</span>
                        )}
                        {mastershopStatus?.configured === true && mastershopVerified === false && (
                            <span className="text-warning"> · la última prueba no fue verificada</span>
                        )}
                    </p>
                    <p className="text-[11px] text-muted">
                        Catálogo habilitado · el envío se confirma manualmente según la ciudad del
                        cliente. Contraentrega:{" "}
                        {mastershopStatus?.cashOnDelivery === true ? (
                            <span className="text-success">
                                habilitada — el registro en Mastershop no confirma despacho ni
                                recaudo; confirma el despacho en el panel del proveedor.
                            </span>
                        ) : (
                            "deshabilitada (MASTERSHOP_COD_ENABLED). Pedidos prepagados se gestionan manualmente."
                        )}
                    </p>
                    <div className="space-y-1.5 text-[11px] text-muted">
                        <p>Lista manual de configuración:</p>
                        <ol className="list-decimal ml-4 space-y-0.5">
                            <li>
                                Define <code className="text-foreground">MASTERSHOP_API_KEY</code>{" "}
                                en las variables de entorno del servidor (Vercel) y vuelve a desplegar.
                                No pegues la clave aquí.
                            </li>
                            <li>
                                Agrega los productos que vas a vender a «Mis productos» en tu cuenta
                                de Mastershop.
                            </li>
                            <li>Prueba el acceso con el botón de abajo.</li>
                        </ol>
                    </div>
                    <button
                        type="button"
                        onClick={() => void probeMastershopAccess()}
                        disabled={mastershopProbing}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                        {mastershopProbing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                        {mastershopProbing ? "Probando..." : "Probar acceso"}
                    </button>
                </div>

                {/* AliExpress DS */}
                <div className="glass rounded-3xl p-6 space-y-3">
                    <h4 className="font-heading text-base font-bold text-foreground flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-accent-dark" />
                        AliExpress Dropshipping
                        <span className="px-2 py-0.5 rounded-full border border-black/10 text-[10px] font-semibold text-muted">
                            Solo estadísticas
                        </span>
                    </h4>
                    <p className="text-[11px]">
                        {statusLine(dsStatus, "Estado")}
                    </p>
                    <div className="space-y-1.5 text-[11px] text-muted">
                        <p>Lista manual de configuración:</p>
                        <ol className="list-decimal ml-4 space-y-0.5">
                            <li>Autoriza la cuenta DS con el botón de abajo.</li>
                            <li>Carga los feeds y selecciona el feed del centro DS.</li>
                            <li>Guarda el feed; el refresco de tendencias usa ese feed.</li>
                        </ol>
                    </div>
                    <a
                        href="/api/admin/providers/aliexpress-ds/authorize"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-all"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Conectar AliExpress DS
                    </a>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void loadDsFeeds()}
                            disabled={dsFeedsBusy}
                            className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {dsFeedsBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                            {dsFeedsBusy ? "Cargando..." : "Cargar feeds"}
                        </button>
                    </div>
                    {dsFeeds.length > 0 && (
                        <div className="flex flex-col sm:flex-row gap-2">
                            <select
                                value={dsFeedChoice}
                                onChange={(e) => setDsFeedChoice(e.target.value)}
                                className={inputClass}
                                aria-label="Feed DS"
                            >
                                <option value="">Selecciona feed…</option>
                                {dsFeeds.map((f) => (
                                    <option key={f.name} value={f.name}>
                                        {f.name}
                                        {typeof f.productCount === "number" ? ` (${f.productCount})` : ""}
                                        {f.description ? ` — ${f.description}` : ""}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => void saveDsFeed()}
                                disabled={dsFeedsBusy || !dsFeedChoice}
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold transition-all disabled:opacity-50 shrink-0"
                            >
                                Guardar feed
                            </button>
                        </div>
                    )}
                    <details className="text-[11px]">
                        <summary className="cursor-pointer text-accent-dark flex items-center gap-1.5">
                            <Wrench className="w-3 h-3" /> Diagnóstico DS
                        </summary>
                        <div className="mt-2 space-y-2">
                            <button
                                type="button"
                                onClick={() => void runDsDiagnostics()}
                                disabled={dsDiagBusy}
                                className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold disabled:opacity-50"
                            >
                                {dsDiagBusy ? "Ejecutando..." : "Ejecutar diagnóstico"}
                            </button>
                            {dsDiag && (
                                <div className="space-y-2">
                                    <pre className="max-h-64 overflow-auto rounded-xl bg-surface p-3 text-[10px] text-muted whitespace-pre-wrap break-all">
                                        {dsDiag}
                                    </pre>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard
                                                ?.writeText(dsDiag)
                                                .then(() => setDsDiagCopied(true))
                                                .catch(() => setError("No se pudo copiar al portapapeles."));
                                        }}
                                        className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold flex items-center gap-1.5"
                                    >
                                        <Copy className="w-3 h-3" />
                                        {dsDiagCopied ? "Copiado" : "Copiar diagnóstico"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </details>
                </div>

                {/* CJ Dropshipping */}
                <div className="glass rounded-3xl p-6 space-y-3">
                    <h4 className="font-heading text-base font-bold text-foreground flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-accent-dark" />
                        CJ Dropshipping
                        <span className="px-2 py-0.5 rounded-full border border-black/10 text-[10px] font-semibold text-muted">
                            Solo estadísticas
                        </span>
                    </h4>
                    <p className="text-[11px]">{statusLine(cjStatus, "Estado")}</p>
                    <p className="text-[11px] text-muted">
                        CJ usa una clave de API por servidor (no OAuth). Configura{" "}
                        <code className="text-foreground">CJ_API_KEY</code> en Vercel con la clave
                        del panel de CJ Dropshipping y vuelve a desplegar. También es requisito{" "}
                        <code className="text-foreground">PROVIDER_TOKEN_ENCRYPTION_KEY</code>{" "}
                        (clave compartida para cifrar tokens de proveedores). No pegues la clave aquí.
                    </p>
                </div>

                {/* AliExpress Affiliate */}
                <div className="glass rounded-3xl p-6 space-y-3">
                    <h4 className="font-heading text-base font-bold text-foreground flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-accent-dark" />
                        AliExpress Afiliados
                        <span className="px-2 py-0.5 rounded-full border border-black/10 text-[10px] font-semibold text-muted">
                            Solo estadísticas
                        </span>
                    </h4>
                    <p className="text-[11px]">{statusLine(affiliateStatus, "Estado")}</p>
                    <p className="text-[11px] text-muted">
                        Requiere <code className="text-foreground">ALIEXPRESS_APP_KEY</code>,{" "}
                        <code className="text-foreground">ALIEXPRESS_APP_SECRET</code> y{" "}
                        <code className="text-foreground">ALIEXPRESS_TRACKING_ID</code> en variables
                        de entorno del servidor.
                    </p>
                </div>

                {/* MercadoLibre */}
                <div className="glass rounded-3xl p-6 space-y-3">
                    <h4 className="font-heading text-base font-bold text-foreground flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-accent-dark" />
                        MercadoLibre
                    </h4>
                    <p className="text-[11px]">{statusLine(meliStatus, "Estado")}</p>
                    <a
                        href="/api/admin/providers/meli/authorize"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-foreground text-xs font-semibold transition-all"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Conectar MercadoLibre
                    </a>
                </div>
            </div>
        </div>
    );
}
