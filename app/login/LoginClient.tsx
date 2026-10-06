"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Sparkles,
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
    User,
    Gift,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import FadeIn from "@/components/common/FadeIn";

export default function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectUrl = searchParams.get("redirect") || "/";

    const { login, registerCustomer } = useAuthStore();

    // Toggle between login and registration
    const [mode, setMode] = useState<"login" | "register">("login");

    // Common fields
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    // Registration fields (Customers only)
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [cedula, setCedula] = useState("");
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("Bogotá");
    const [referralCode, setReferralCode] = useState("");

    // Feedback
    const [statusMessage, setStatusMessage] = useState<{ text: string; error?: boolean } | null>(null);
    const [loading, setLoading] = useState(false);

    const handleLoginSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setStatusMessage(null);
        setLoading(true);

        setTimeout(() => {
            const result = login(email, password);
            setLoading(false);

            if (result.success && result.user) {
                const isAdmin = result.user.role === "admin";
                setStatusMessage({
                    text: `¡Bienvenido, ${result.user.name}! Detectado como ${isAdmin ? "Administrador 🛡️" : "Cliente 👤"}. Redirigiendo...`,
                });

                setTimeout(() => {
                    if (isAdmin) {
                        // Admins are routed to Operator Command Center by default
                        router.push(redirectUrl === "/" ? "/operator" : redirectUrl);
                    } else {
                        // Customers are routed to their Account page or previous page
                        router.push(redirectUrl === "/" ? "/account" : redirectUrl);
                    }
                }, 700);
            } else {
                setStatusMessage({ text: result.message, error: true });
            }
        }, 350);
    };

    const handleRegisterSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setStatusMessage(null);
        setLoading(true);

        setTimeout(() => {
            // Public registration creates strictly customer accounts
            const result = registerCustomer({
                name,
                email,
                password,
                phone,
                cedula,
                address,
                city,
                referralCode: referralCode || undefined,
            });

            setLoading(false);
            if (result.success) {
                setStatusMessage({
                    text: "¡Cuenta de cliente creada exitosamente! Redirigiendo a tu perfil...",
                });
                setTimeout(() => {
                    router.push(redirectUrl === "/" ? "/account" : redirectUrl);
                }, 700);
            } else {
                setStatusMessage({ text: result.message, error: true });
            }
        }, 400);
    };

    const handleQuickFill = (emailValue: string, passwordValue: string) => {
        setEmail(emailValue);
        setPassword(passwordValue);
        setMode("login");
        setStatusMessage({
            text: `Credenciales cargadas para ${emailValue}. Haz clic en Iniciar Sesión para verificar la detección automática de rol.`,
        });
    };

    const inputClass =
        "w-full pl-10 pr-4 py-3 rounded-2xl bg-surface border border-white/10 text-white placeholder-muted focus:outline-none focus:border-primary transition-colors text-xs sm:text-sm";

    return (
        <div className="pt-28 pb-16 px-4 min-h-screen flex items-center justify-center">
            <div className="w-full max-w-lg">
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
                            {mode === "login" ? "Iniciar Sesión" : "Crear Cuenta de Cliente"}
                        </h1>
                        <p className="text-xs sm:text-sm text-muted">
                            {mode === "login"
                                ? "Ingresa con tu correo y contraseña. El sistema detectará automáticamente si eres Cliente o Administrador."
                                : "Regístrate en LuzClub VIP para acumular puntos, recibir descuentos y generar enlaces de referidos."}
                        </p>
                    </div>

                    {/* Mode Toggle (Iniciar Sesión vs Crear Cuenta) */}
                    <div className="flex rounded-2xl bg-surface-card p-1.5 border border-white/10 mb-6">
                        <button
                            type="button"
                            onClick={() => {
                                setMode("login");
                                setStatusMessage(null);
                            }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                                mode === "login"
                                    ? "bg-primary text-white shadow-lg glow-purple"
                                    : "text-muted hover:text-white"
                            }`}
                        >
                            Iniciar Sesión
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode("register");
                                setStatusMessage(null);
                            }}
                            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                                mode === "register"
                                    ? "bg-primary text-white shadow-lg glow-purple"
                                    : "text-muted hover:text-white"
                            }`}
                        >
                            Crear Cuenta (Cliente VIP)
                        </button>
                    </div>

                    {/* Quick Demo Helper Box */}
                    {mode === "login" && (
                        <div className="p-4 rounded-2xl bg-gradient-to-r from-surface-card via-surface to-primary/10 border border-primary/20 mb-6">
                            <div className="flex items-center justify-between gap-3 mb-2.5">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-accent flex items-center gap-1">
                                    <Sparkles className="w-3.5 h-3.5" /> Autocompletar Cuenta Demo
                                </span>
                                <span className="text-[10px] text-muted">Detección de Rol Automática</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleQuickFill("carolina.mejia@gmail.com", "luz123")}
                                    className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium border border-white/10 flex items-center justify-between transition-colors text-left"
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        <span>👤</span>
                                        <span className="truncate">Carolina (Cliente)</span>
                                    </span>
                                    <span className="text-[10px] text-primary shrink-0 font-mono">Auto-fill</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleQuickFill("admin@luzmagica.co", "admin123")}
                                    className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium border border-amber-500/20 flex items-center justify-between transition-colors text-left"
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        <span>🛡️</span>
                                        <span className="truncate">Henry (Admin)</span>
                                    </span>
                                    <span className="text-[10px] text-amber-400 shrink-0 font-mono">Auto-fill</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Main Form Container */}
                    <div className="glass rounded-3xl p-6 sm:p-8 border border-white/10 shadow-2xl">
                        {mode === "login" ? (
                            /* UNIFIED LOGIN FORM: Strictly Email & Password */
                            <form onSubmit={handleLoginSubmit} className="space-y-4">
                                <div>
                                    <label className="text-xs text-muted mb-1 block">Correo Electrónico *</label>
                                    <div className="relative">
                                        <Mail className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="tu@correo.com o admin@luzmagica.co"
                                            className={inputClass}
                                        />
                                    </div>
                                </div>

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

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-3.5 px-6 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                                >
                                    {loading ? (
                                        <span className="animate-pulse">Validando credenciales...</span>
                                    ) : (
                                        <>
                                            <span>Iniciar Sesión</span>
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </form>
                        ) : (
                            /* CUSTOMER REGISTRATION FORM (Role is strictly customer) */
                            <form onSubmit={handleRegisterSubmit} className="space-y-4">
                                <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 text-xs text-primary/90 flex items-center gap-2 mb-2">
                                    <Sparkles className="w-4 h-4 shrink-0" />
                                    <span>
                                        Al registrarte ganas <strong>150 Puntos LuzClub</strong> de bienvenida y tu enlace de referidos.
                                    </span>
                                </div>

                                <div>
                                    <label className="text-xs text-muted mb-1 block">Nombre Completo *</label>
                                    <div className="relative">
                                        <User className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                        <input
                                            type="text"
                                            required
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Tu nombre completo"
                                            className={inputClass}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-muted mb-1 block">Correo Electrónico *</label>
                                        <div className="relative">
                                            <Mail className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                            <input
                                                type="email"
                                                required
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="tu@correo.com"
                                                className={inputClass}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs text-muted mb-1 block">Contraseña *</label>
                                        <div className="relative">
                                            <Lock className="w-4 h-4 text-muted absolute left-3.5 top-3.5" />
                                            <input
                                                type="password"
                                                required
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="••••••••"
                                                className={inputClass}
                                            />
                                        </div>
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
                                                placeholder="310 000 0000"
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
                                                placeholder="Requerido para envíos"
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
                                                placeholder="Calle, número, apto"
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

                                <div>
                                    <label className="text-xs text-muted mb-1 block">
                                        Código de Referido (Opcional - Recibe $20.000 COP)
                                    </label>
                                    <div className="relative">
                                        <Gift className="w-4 h-4 text-accent absolute left-3.5 top-3.5" />
                                        <input
                                            type="text"
                                            value={referralCode}
                                            onChange={(e) => setReferralCode(e.target.value)}
                                            placeholder="Ej: LUZ-CAROLINA"
                                            className={`${inputClass} uppercase font-mono`}
                                        />
                                    </div>
                                </div>

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

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-3.5 px-6 rounded-2xl bg-primary hover:bg-primary-light text-white font-semibold flex items-center justify-center gap-2 glow-purple transition-all text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                                >
                                    {loading ? (
                                        <span className="animate-pulse">Creando cuenta...</span>
                                    ) : (
                                        <>
                                            <span>Completar Registro de Cliente</span>
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                </FadeIn>
            </div>
        </div>
    );
}
