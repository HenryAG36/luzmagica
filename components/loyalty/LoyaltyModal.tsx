"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Award, Gift, Copy, Check, TrendingUp, ShieldCheck } from "lucide-react";
import { useLoyaltyStore } from "@/store/useLoyaltyStore";
import { publicSiteOrigin } from "@/lib/contact";
import { formatCOP } from "@/lib/utils";

export default function LoyaltyModal() {
    const { account, isModalOpen, closeModal, getTierProgress, getTierMultiplier } = useLoyaltyStore();
    const [copied, setCopied] = useState(false);

    if (!isModalOpen) return null;

    const { currentTier, nextTier, pointsToNext, progressPercent } = getTierProgress();
    const multiplier = getTierMultiplier();
    const pointsValueInCOP = account.points * 10;

    const handleCopy = () => {
        navigator.clipboard.writeText(
            `¡Usa mi código ${account.referralCode} en LuzMágica! ${publicSiteOrigin()}`
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const tierColors = {
        bronce: "from-amber-700 to-amber-900 border-amber-600/40 text-amber-200",
        plata: "from-slate-400 to-slate-600 border-slate-400/40 text-slate-100",
        oro: "from-yellow-400 to-amber-600 border-yellow-400/40 text-yellow-100",
        galactico: "from-purple-500 via-indigo-600 to-pink-500 border-purple-400/40 text-purple-100",
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-surface border border-white/10 p-6 md:p-8 shadow-2xl glow-purple"
                >
                    {/* Close button */}
                    <button
                        onClick={closeModal}
                        className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                        aria-label="Cerrar modal"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Header */}
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="font-heading text-2xl font-bold text-white">LuzClub VIP</h2>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-gradient-to-r ${tierColors[currentTier]}`}>
                                    Nivel {currentTier}
                                </span>
                            </div>
                            <p className="text-xs text-muted">Tu programa de fidelización y recompensas exclusivas</p>
                        </div>
                    </div>

                    {/* Balance Card */}
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/20 via-surface-card to-secondary/10 border border-primary/30 mb-6">
                        <div className="flex items-end justify-between mb-3">
                            <div>
                                <span className="text-xs text-muted block mb-1">Puntos Disponibles</span>
                                <span className="font-heading text-4xl font-extrabold text-white tracking-tight">
                                    {account.points.toLocaleString()} <span className="text-sm font-normal text-primary">pts</span>
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-xs text-muted block mb-1">Equivalente en Descuento</span>
                                <span className="font-heading text-xl font-bold text-green-400">
                                    {formatCOP(pointsValueInCOP)}
                                </span>
                            </div>
                        </div>

                        {/* Progress Bar to next tier */}
                        <div className="mt-4 pt-4 border-t border-white/10">
                            <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-muted">
                                    {nextTier ? `Faltan ${pointsToNext.toLocaleString()} pts para Nivel ${nextTier.toUpperCase()}` : "¡Alcanzaste el Nivel Máximo Galáctico!"}
                                </span>
                                <span className="font-semibold text-white">{progressPercent}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progressPercent}%` }}
                                    transition={{ duration: 0.8, ease: "easeOut" }}
                                    className="h-full bg-gradient-to-r from-primary to-secondary"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Member Benefits Grid */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="p-3.5 rounded-xl bg-surface-card border border-white/5 flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                                <TrendingUp className="w-4 h-4" />
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-white mb-0.5">Multiplicador {multiplier}x</h4>
                                <p className="text-[11px] text-muted leading-tight">Acumulas {multiplier} pts por cada $1.000 COP en compras.</p>
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-surface-card border border-white/5 flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-green-500/10 text-green-400 shrink-0">
                                <Gift className="w-4 h-4" />
                            </div>
                            <div>
                                <h4 className="text-xs font-semibold text-white mb-0.5">Canje Inmediato</h4>
                                <p className="text-[11px] text-muted leading-tight">Aplica tus puntos como descuento directo en el checkout.</p>
                            </div>
                        </div>
                    </div>

                    {/* Referral Box (only when the account has a real referral code) */}
                    {account.referralCode ? (
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Award className="w-4 h-4 text-accent" />
                            <h4 className="text-sm font-semibold text-white">Tu código de referido</h4>
                        </div>
                        <p className="text-xs text-muted mb-3">
                            Comparte tu código con amigos para invitarlos a la tienda.
                        </p>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 bg-surface px-3 py-2 rounded-xl border border-white/10 text-xs font-mono text-white truncate">
                                {account.referralCode}
                            </div>
                            <button
                                onClick={handleCopy}
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                            >
                                {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                                {copied ? "Copiado!" : "Copiar Enlace"}
                            </button>
                        </div>
                    </div>
                    ) : null}

                    {/* Points Activity History */}
                    <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Historial de Puntos</h4>
                        {account.history.length === 0 ? (
                            <p className="text-xs text-muted">Aún no tienes movimientos de puntos.</p>
                        ) : null}
                        <div className="space-y-2">
                            {account.history.slice(0, 4).map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between p-2.5 rounded-xl bg-surface-card/60 border border-white/5 text-xs">
                                    <div>
                                        <p className="text-white font-medium">{tx.reason}</p>
                                        <p className="text-[10px] text-muted">{tx.date}</p>
                                    </div>
                                    <span className={`font-bold font-mono ${tx.type === "earned" ? "text-green-400" : "text-amber-400"}`}>
                                        {tx.type === "earned" ? `+${tx.points}` : `-${tx.points}`} pts
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                            Beneficios según el programa LuzClub vigente
                        </div>
                        <button
                            onClick={closeModal}
                            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
                        >
                            Listo
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
