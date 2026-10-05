"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Sparkles,
    ShieldCheck,
    User,
    Lock,
    Mail,
    ArrowRight,
    CheckCircle2,
    AlertCircle,
    Eye,
    EyeOff,
    Phone,
    MapPin,
    FileText,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import FadeIn from "@/components/common/FadeIn";

export default function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectUrl = searchParams.get("redirect") || "/";

    const { login, register, quickDemoLogin } = useAuthStore();

    // Portal mode: customer or admin
    const [portalType, setPortalType] = useState<"customer" | "admin">(
        redirectUrl.includes("operator") ? "admin" : "customer"
    );

    // Customer mode: login or register
    const [isRegistering, setIsRegistering] = useState(false);

    // Form states
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    // Registration extra fields
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [cedula, setCedula] = useState("");
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("Bogotá");

    // Feedback
    const [statusMessage, setStatusMessage] = useState<{ text: string; error?: boolean } | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setStatusMessage(null);
        setLoading(true);

        setTimeout(() => {
            if (portalType === "customer" && isRegistering) {
                const result = register({
                    name,
                    email,
                    password,
                    role: "customer",
                    phone,
                    cedula,
                    address,
                    city,
                });

                setLoading(false);
                if (result.success) {
                    setStatusMessage({ text: result.message });
                    setTimeout(() => {
                        router.push(redirectUrl === "/" ? "/account" : redirectUrl);
                    }, 800);
                } else {
                    setStatusMessage({ text: result.message, error: true });
                }
            } else {
                const result = login(email, password);
                setLoading(false);

                if (result.success) {
                    setStatusMessage({ text: result.message });

                    // Check if admin is logging in from admin tab or customer tab
                    if (portalType === "admin" && result.user?.role !== "admin") {
                        setStatusMessage({
                            text: "Esta cuenta no tiene permisos de administrador.",
                            error: true,
                        });
                        return;
                    }

                    setTimeout(() => {
                        if (result.user?.role === "admin") {
                            router.push(redirectUrl === "/" ? "/operator" : redirectUrl);
                        } else {
                            router.push(redirectUrl === "/" ? "/account" : redirectUrl);
                        }
                    }, 800);
                } else {
                    setStatusMessage({ text: result.message, error: true });
                }
            }
        }, 400);
    };

    const handleQuickLogin = (role: "customer" | "admin") => {
        setLoading(true);
        setStatusMessage(null);

        setTimeout(() => {
            const user = quickDemoLogin(role);
            setLoading(false);
            setStatusMessage({ text: `Accediendo como ${user.name}...` });

            setTimeout(() => {
                if (role === "admin") {
                    router.push("/operator");
                } else {
                    router.push(redirectUrl === "/" ? "/account" : redirectUrl);
                }
            }, 600);
        }, 300);
    };

    const inputClass =
        "w-full pl-10 pr-4 py-3 rounded-2xl bg-surface border border-white/10 text-white placeholder-muted focus:outline-none focus:border-primary transition-colors text-xs sm:text-sm";

    return (
        <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
            <div className="w-full max-w-xl">
                <FadeIn>
                    {/* Header */}
                    <div className="text-center mb-8">
                        <Link href="/" className="inline-flex items-center gap-2 mb-4 group">
                            <Sparkles className="w-7 h-7 text-primary transition-transform group-hover:rotate-12" />
                            <span className="font-heading text-2xl font-bold tracking-tight">
                                <span className="text-white">Luz</span>
                                <span className="gradient-text">Mágica</span>
                            </span>
                        </Link>
                        <h1 className="font-heading text-3xl font-bold text-white mb-2">
                            {portalType === "admin"
                                ? "Portal del Administrador"
                                : isRegistering
                                ? "Crea tu Cuenta LuzClub"
                                : "Bienvenido de Nuevo"}
                        </h1>
                        <p className="text-xs sm:text-sm text-muted">
                            {portalType === "admin"
                                ? "Acceso seguro al Command Center y gestión operativa de la tienda"
                                : isRegistering
                                ? "Regístrate para acumular puntos, rastrear envíos y obtener beneficios VIP"
                                : "Inicia sesión para gestionar tus pedidos y canjear tus puntos LuzClub"}
                        </p>
                    </div>

                    {/* Portal Selector Tabs */}
                    <div className="flex rounded-2xl bg-surface-card p-1.5 border border-white/10 mb-6">
                        <button
                            type="button"
                            onClick={() => {
                                setPortalType("customer");
                                setStatusMessage(null);
                            }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                                portalType === "customer"
                                    ? "bg-primary text-white shadow-lg glow-purple"
                                    : "text-muted hover:text-white"
                            }`}
                        >
                            <User className="w-4 h-4" />
                            <span>Portal Cliente VIP</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setPortalType("admin");
                                setIsRegistering(false);
                                setStatusMessage(null);
                            }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                                portalType === "admin"
                                    ? "bg-amber-500 text-black font-bold shadow-lg"
                                    : "text-muted hover:text-white"
                            }`}
                        >
                            <ShieldCheck className="w-4 h-4" />
                            <span>Portal Administrador</span>
                        </button>
                    </div>

                    {/* Quick Demo Access Bar */}
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-surface-card via-surface to-primary/10 border border-primary/20 mb-6">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-accent flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" /> Acceso Rápido de Prueba (Demo)
                            </span>
                            <span className="text-[10px] text-muted font-mono">1 Clic</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => handleQuickLogin("customer")}
                                disabled={loading}
                                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium border border-white/10 flex items-center justify-between transition-colors disabled:opacity-50"
                            >
                                <span className="flex items-center gap-1.5">
                                    <span>👤</span>
                                    <span>Carolina (Cliente)</span>
                                </span>
                                <span className="text-[10px] text-primary font-mono">luz123</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleQuickLogin("admin")}
                                disabled={loading}
                                className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium border border-amber-500/20 flex items-center justify-between transition-colors disabled:opacity-50"
                            >
                                <span className="flex items-center gap-1.5">
                                    <span>🛡️</span>
                                    <span>Henry (Admin)</span>
                                </span>
                                <span className="text-[10px] text-amber-400 font-mono">admin123</span>
                            </button>
                        </div>
                    </div>

                    {/* Main Form Container */}
                    <div className="glass rounded-3xl p-6 sm:p-8 border border-white/10 shadow-2xl">
                        {/* Customer Mode Sub-tabs (Login / Register) */}
                        {portalType === "customer" && (
                            <div className="flex border-b border-white/10 mb-6 pb-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsRegistering(false);
                                        setStatusMessage(null);
                                    }}
                                    className={`mr-6 pb-2 text-sm font-semibold transition-colors relative ${
                                        !isRegistering ? "text-white" : "text-muted hover:text-white"
                                    }`}
                                >
                                    Iniciar Sesión
                                    {!isRegistering && (
                                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsRegistering(true);
                                        setStatusMessage(null);
                                    }}
                                    className={`pb-2 text-sm font-semibold transition-colors relative ${
                                        isRegistering ? "text-white" : "text-muted hover:text-white"
                                    }`}
                                >
                                    Crear Cuenta
                                    {isRegistering && (
                                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                                    )}
                                </button>
                            </div>
                        )}

                        {portalType === "admin" && (
                            <div className="mb-6 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                                <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-200/90 leading-relaxed">
                                    <strong>Área Restringida:</strong> Requiere credenciales de nivel operador.
                                    Gestiona pedidos, márgenes brutos de dropshipping y recuperación de carritos.
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Extra fields if registering as customer */}
                            {portalType === "customer" && isRegistering && (
                                <>
                                    <div>
                                        <label className="text-xs text-muted mb-1 block">Nombre Completo *</label>
                                        <div className="relative">
                                            <User className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                            <input
                                                type="text"
                                                required
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Ej: Carolina Mejía"
                                                className={inputClass}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Teléfono / WhatsApp *</label>
                                            <div className="relative">
                                                <Phone className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                                <input
                                                    type="tel"
                                                    required
                                                    value={phone}
                                                    onChange={(e) => setPhone(e.target.value)}
                                                    placeholder="310 456 7890"
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Cédula de Ciudadanía *</label>
                                            <div className="relative">
                                                <FileText className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                                <input
                                                    type="text"
                                                    required
                                                    value={cedula}
                                                    onChange={(e) => setCedula(e.target.value)}
                                                    placeholder="Para guías de envío"
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Dirección de Entrega *</label>
                                            <div className="relative">
                                                <MapPin className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                                <input
                                                    type="text"
                                                    required
                                                    value={address}
                                                    onChange={(e) => setAddress(e.target.value)}
                                                    placeholder="Calle 127 #15-32"
                                                    className={inputClass}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted mb-1 block">Ciudad *</label>
                                            <input
                                                type="text"
                                                required
                                                value={city}
                                                onChange={(e) => setCity(e.target.value)}
                                                placeholder="Bogotá, Medellín..."
                                                className="w-full px-4 py-3 rounded-2xl bg-surface border border-white/10 text-white placeholder-muted focus:outline-none focus:border-primary text-xs sm:text-sm"
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Email */}
                            <div>
                                <label className="text-xs text-muted mb-1 block">
                                    {portalType === "admin" ? "Correo Corporativo *" : "Correo Electrónico *"}
                                </label>
                                <div className="relative">
                                    <Mail className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder={portalType === "admin" ? "admin@luzmagica.co" : "tu@correo.com"}
                                        className={inputClass}
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="text-xs text-muted mb-1 block">Contraseña *</label>
                                <div className="relative">
                                    <Lock className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className={`${inputClass} pr-10`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-3.5 text-muted hover:text-white"
                                        aria-label="Ver contraseña"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Status Feedback */}
                            {statusMessage && (
                                <div
                                    className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 ${
                                        statusMessage.error
                                            ? "bg-red-500/15 border border-red-500/30 text-red-200"
                                            : "bg-green-500/15 border border-green-500/30 text-green-200"
                                    }`}
                                >
                                    {statusMessage.error ? (
                                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                                    ) : (
                                        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                                    )}
                                    <span>{statusMessage.text}</span>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full py-3.5 px-6 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all text-xs sm:text-sm cursor-pointer disabled:opacity-50 ${
                                    portalType === "admin"
                                        ? "bg-amber-500 hover:bg-amber-400 text-black font-bold shadow-lg shadow-amber-500/20"
                                        : "bg-primary hover:bg-primary-light text-white glow-purple"
                                }`}
                            >
                                {loading ? (
                                    <span className="animate-pulse">Verificando credenciales...</span>
                                ) : (
                                    <>
                                        <span>
                                            {portalType === "admin"
                                                ? "Acceder al Command Center"
                                                : isRegistering
                                                ? "Crear Cuenta y Ganar Puntos"
                                                : "Iniciar Sesión"}
                                        </span>
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </FadeIn>
            </div>
        </div>
    );
}
