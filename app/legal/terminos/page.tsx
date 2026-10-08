import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Términos y Condiciones | LuzMágica",
    description: "Términos y condiciones de compra en LuzMágica Colombia.",
};

export default function TerminosPage() {
    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-3xl mx-auto">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 inline-block mb-4">
                    Ley 1480 de 2011 • Colombia
                </span>
                <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-8">
                    Términos y <span className="gradient-text">Condiciones</span>
                </h1>

                <div className="space-y-6 text-sm text-muted leading-relaxed">
                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">1. Objeto</h2>
                        <p>
                            Estos términos regulan la compra de productos ofrecidos por LuzMágica a través de este
                            sitio. Al realizar un pedido aceptas estas condiciones.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">2. Precios y pagos</h2>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Todos los precios se muestran en pesos colombianos (COP).</li>
                            <li>El total cobrado incluye producto, descuentos aplicables y envío confirmado al momento del pedido.</li>
                            <li>El pago se procesa de forma segura a través de Wompi; la tienda nunca recibe ni almacena datos de tarjetas.</li>
                            <li>Un pedido solo se confirma cuando la pasarela verifica el pago.</li>
                        </ul>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">3. Envíos y tiempos de entrega</h2>
                        <ul className="list-disc list-inside space-y-1">
                            <li>
                                Los productos marcados como <strong className="text-white">envío internacional</strong>{" "}
                                se despachan desde proveedores en el exterior y tienen tiempos de entrega
                                estimados de 15 a 30 días hábiles.
                            </li>
                            <li>Los tiempos de entrega son estimados y pueden variar por aduana y transportadora.</li>
                            <li>El estado del pedido puede consultarse en la página de rastreo con la referencia y el dato de contacto de compra.</li>
                        </ul>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">4. Disponibilidad</h2>
                        <p>
                            El stock se descuenta al confirmarse el pago. Si un producto pagado deja de estar
                            disponible con el proveedor, te contactaremos para ofrecer reembolso completo o un
                            producto equivalente.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">5. Datos personales</h2>
                        <p>
                            El tratamiento de tus datos se rige por nuestra{" "}
                            <a href="/legal/privacidad" className="text-primary hover:underline">
                                política de privacidad
                            </a>
                            , conforme a la Ley 1581 de 2012.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">6. Ley aplicable</h2>
                        <p>
                            Estas condiciones se rigen por las leyes de la República de Colombia, incluido el
                            Estatuto del Consumidor (Ley 1480 de 2011).
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
