"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LoyaltyAccount, LoyaltyTier, PointsTransaction } from "@/lib/types";
import { TIER_THRESHOLDS, calculateTier } from "@/lib/loyalty";
import { migrateLoyaltyPersisted } from "@/store/migrations";

interface LoyaltyState {
    account: LoyaltyAccount;
    isModalOpen: boolean;

    openModal: () => void;
    closeModal: () => void;
    awardPoints: (amountCOP: number, orderId: string) => number;
    redeemPoints: (points: number, reason?: string) => boolean;
    refundPoints: (points: number, reason: string) => void;
    getTierMultiplier: () => number;
    calculatePointsForCOP: (amountCOP: number) => number;
    getTierProgress: () => {
        currentTier: LoyaltyTier;
        nextTier: LoyaltyTier | null;
        pointsToNext: number;
        progressPercent: number;
    };
}

export const useLoyaltyStore = create<LoyaltyState>()(
    persist(
        (set, get) => ({
            account: {
                points: 0,
                lifetimePoints: 0,
                tier: "bronce",
                referralCode: "",
                history: [],
            },
            isModalOpen: false,

            openModal: () => set({ isModalOpen: true }),
            closeModal: () => set({ isModalOpen: false }),

            getTierMultiplier: () => {
                const tier = get().account.tier;
                if (tier === "galactico") return 2.0;
                if (tier === "oro") return 1.5;
                if (tier === "plata") return 1.25;
                return 1.0;
            },

            calculatePointsForCOP: (amountCOP: number) => {
                const multiplier = get().getTierMultiplier();
                // 1 base point per 1000 COP * multiplier
                return Math.floor((amountCOP / 1000) * multiplier);
            },

            awardPoints: (amountCOP: number, orderId: string) => {
                const earned = get().calculatePointsForCOP(amountCOP);
                if (earned <= 0) return 0;

                const current = get().account;
                const newLifetime = current.lifetimePoints + earned;
                const newPoints = current.points + earned;
                const newTier = calculateTier(newLifetime);

                const newTx: PointsTransaction = {
                    id: `tx-${Date.now()}`,
                    date: new Date().toISOString().split("T")[0],
                    points: earned,
                    reason: `Compra completada #${orderId}`,
                    type: "earned",
                };

                set({
                    account: {
                        ...current,
                        points: newPoints,
                        lifetimePoints: newLifetime,
                        tier: newTier,
                        history: [newTx, ...current.history],
                    },
                });

                return earned;
            },

            redeemPoints: (points: number, reason = "Canje de descuento en pedido") => {
                const current = get().account;
                if (points <= 0 || points > current.points) return false;

                const newTx: PointsTransaction = {
                    id: `tx-${Date.now()}`,
                    date: new Date().toISOString().split("T")[0],
                    points,
                    reason,
                    type: "redeemed",
                };

                set({
                    account: {
                        ...current,
                        points: current.points - points,
                        history: [newTx, ...current.history],
                    },
                });

                return true;
            },

            refundPoints: (points: number, reason: string) => {
                const current = get().account;
                const newTx: PointsTransaction = {
                    id: `tx-${Date.now()}`,
                    date: new Date().toISOString().split("T")[0],
                    points,
                    reason,
                    type: "earned",
                };

                set({
                    account: {
                        ...current,
                        points: current.points + points,
                        history: [newTx, ...current.history],
                    },
                });
            },

            getTierProgress: () => {
                const lifetime = get().account.lifetimePoints;
                const currentTier = get().account.tier;

                if (currentTier === "galactico") {
                    return {
                        currentTier,
                        nextTier: null,
                        pointsToNext: 0,
                        progressPercent: 100,
                    };
                }

                if (currentTier === "oro") {
                    const remaining = Math.max(0, TIER_THRESHOLDS.galactico - lifetime);
                    const range = TIER_THRESHOLDS.galactico - TIER_THRESHOLDS.oro;
                    const done = lifetime - TIER_THRESHOLDS.oro;
                    return {
                        currentTier,
                        nextTier: "galactico" as LoyaltyTier,
                        pointsToNext: remaining,
                        progressPercent: Math.min(100, Math.round((done / range) * 100)),
                    };
                }

                if (currentTier === "plata") {
                    const remaining = Math.max(0, TIER_THRESHOLDS.oro - lifetime);
                    const range = TIER_THRESHOLDS.oro - TIER_THRESHOLDS.plata;
                    const done = lifetime - TIER_THRESHOLDS.plata;
                    return {
                        currentTier,
                        nextTier: "oro" as LoyaltyTier,
                        pointsToNext: remaining,
                        progressPercent: Math.min(100, Math.round((done / range) * 100)),
                    };
                }

                // bronce
                const remaining = Math.max(0, TIER_THRESHOLDS.plata - lifetime);
                const range = TIER_THRESHOLDS.plata;
                return {
                    currentTier,
                    nextTier: "plata" as LoyaltyTier,
                    pointsToNext: remaining,
                    progressPercent: Math.min(100, Math.round((lifetime / range) * 100)),
                };
            },
        }),
        {
            name: "luzmagica-loyalty-v1",
            version: 1,
            migrate: (persisted) => migrateLoyaltyPersisted(persisted) as LoyaltyState,
        }
    )
);
