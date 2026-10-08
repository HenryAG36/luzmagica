import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Devoluciones y Derecho de Retracto | LuzMágica",
    description: "Política de devoluciones, garantías y derecho de retracto de LuzMágica Colombia.",
};

export default function DevolucionesPage() {
    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-3xl mx-auto">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 inline-block mb-4">
                    Estatuto del Consumidor • Ley 1480 de 2011
                </span>
                <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-8">
                    Devoluciones y <span className="gradient-text">Retracto</span>
                </h1>

                <div className="space-y-6 text-sm text-muted leading-relaxed">
                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">1. Derecho de retracto</h2>
                        <p>
                            Conforme al artículo 47 de la Ley 1480 de 2011, puedes retractarte de tu compra dentro de
                            los <strong className="text-white">5 días hábiles</strong> siguientes a la entrega del
                            producto, siempre que el artículo no haya sido usado y conserve su empaque original.
                        </p>
                        <p className="mt-3">
                            Para ejercerlo, contáctanos por los canales publicados en la tienda indicando tu
                            referencia de pedido. El reembolso se realiza por el mismo medio de pago en un plazo
                            máximo de 30 días calendario desde que recibimos el producto devuelto.
                        </p>
                        <p className="mt-3">
                            En retracto, los costos de devolución del producto corren por tu cuenta, conforme a la
                            ley. El costo del envío original no es reembolsable cuando el despacho ya fue realizado.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">2. Garantía legal</h2>
                        <p>
                            Si el producto llega defectuoso, dañado o no coincide con lo publicado, tienes derecho a
                            reparación, reposición o devolución del dinero conforme a la garantía legal colombiana.
                            Reporta el problema con tu referencia de pedido y evidencia (fotos/video) dentro de los
                            primeros días tras la entrega.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">3. Casos no cubiertos</h2>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Daño por mal uso, golpes o manipulación posterior a la entrega.</li>
                            <li>Productos usados o sin empaque original en solicitudes de retracto.</li>
                            <li>Retrasos causados por aduana o transportadora fuera de nuestro control (te ayudamos a gestionar el reclamo igualmente).</li>
                        </ul>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">4. Cómo iniciar una solicitud</h2>
                        <p>
                            Escríbenos con tu <strong className="text-white">referencia de pedido</strong> (la
                            encuentras en tu correo de confirmación o en la página de rastreo), el motivo de la
                            solicitud y evidencia fotográfica cuando aplique. Te responderemos con los pasos a
                            seguir.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
