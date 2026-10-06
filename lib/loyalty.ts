import type { LoyaltyTier } from "@/lib/types";

export const TIER_THRESHOLDS = {
    bronce: 0,
    plata: 500,
    oro: 1500,
    galactico: 3000,
};

export function calculateTier(lifetimePoints: number): LoyaltyTier {
    if (lifetimePoints >= TIER_THRESHOLDS.galactico) return "galactico";
    if (lifetimePoints >= TIER_THRESHOLDS.oro) return "oro";
    if (lifetimePoints >= TIER_THRESHOLDS.plata) return "plata";
    return "bronce";
}
