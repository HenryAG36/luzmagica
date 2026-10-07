import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Política de Tratamiento de Datos | LuzMágica",
    description: "Cómo LuzMágica recolecta, usa y protege tus datos personales conforme a la Ley 1581 de 2012.",
};

export default function PrivacidadPage() {
    return (
        <div className="pt-28 pb-16 px-4">
            <div className="max-w-3xl mx-auto prose-invert">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 inline-block mb-4">
                    Ley 1581 de 2012 • Colombia
                </span>
                <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white mb-8">
                    Política de Tratamiento de <span className="gradient-text">Datos Personales</span>
                </h1>

                <div className="space-y-6 text-sm text-muted leading-relaxed">
                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">1. Responsable</h2>
                        <p>
                            LuzMágica, en adelante &ldquo;la Tienda&rdquo;, es responsable del tratamiento de los datos
                            personales que suministres al realizar un pedido o usar este sitio.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">2. Datos que recolectamos</h2>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Nombre completo y documento de identidad (cédula).</li>
                            <li>Teléfono de contacto y correo electrónico.</li>
                            <li>Dirección de entrega, ciudad y departamento.</li>
                            <li>Detalle de los productos comprados y valor pagado.</li>
                        </ul>
                        <p className="mt-3">
                            Los datos de pago (números de tarjeta, claves o cuentas) son procesados exclusivamente
                            por la pasarela de pagos; la Tienda nunca los recibe ni los almacena.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">3. Finalidad</h2>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Procesar, despachar y entregar tu pedido.</li>
                            <li>Contactarte sobre el estado de tu pedido o incidencias de entrega.</li>
                            <li>Atender solicitudes de garantía, devolución o soporte.</li>
                            <li>Cumplir obligaciones contables y fiscales.</li>
                        </ul>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">4. Compartición con terceros</h2>
                        <p>
                            Para entregar tu pedido compartimos los datos estrictamente necesarios (nombre,
                            dirección, teléfono y documento cuando la transportadora lo exija) con:
                        </p>
                        <ul className="list-disc list-inside space-y-1 mt-2">
                            <li>La pasarela de pagos, para procesar la transacción.</li>
                            <li>Proveedores y operadores logísticos, para el despacho.</li>
                        </ul>
                        <p className="mt-3">No vendemos ni alquilamos datos personales a terceros.</p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">5. Tus derechos</h2>
                        <p>
                            Como titular puedes conocer, actualizar, rectificar y suprimir tus datos, así como
                            revocar el consentimiento, mediante una solicitud a los canales de contacto publicados
                            en la tienda. Responderemos en los términos establecidos por la ley.
                        </p>
                    </section>

                    <section className="glass rounded-2xl p-6">
                        <h2 className="font-heading text-lg font-bold text-white mb-3">6. Vigencia y cambios</h2>
                        <p>
                            Esta política aplica desde su publicación. Cualquier cambio será informado en esta
                            misma página antes de entrar en vigor.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
