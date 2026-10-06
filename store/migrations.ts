// Client-safe persisted-state migrations for the browser stores.
// Each helper removes only exact, known-seeded demo records and preserves
// everything else a real user may have stored.
// Relative .ts imports so the helpers also run under node --experimental-strip-types tests.
import type { CustomerProfile } from "../lib/types.ts";
import { calculateTier } from "../lib/loyalty.ts";

export const SEEDED_ORDER_IDS = new Set(["LM-8921", "LM-9402", "LM-9811"]);
export const SEEDED_ABANDONED_CART_IDS = new Set(["AB-3021", "AB-2940"]);
export const SEEDED_TASK_IDS = new Set(["tsk-1", "tsk-2", "tsk-3"]);
export const SEEDED_LOYALTY_TX_IDS = new Set(["tx-1", "tx-2"]);
export const SEEDED_LOYALTY_REFERRAL_CODE = "LUZ-CAROLINA";
export const SEEDED_PRODUCT_IDS = new Set(["1", "2", "3", "4", "5", "6", "7", "8"]);

export const BLANK_PROFILE: CustomerProfile = {
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    department: "",
    cedula: "",
    notes: "",
};

const SEEDED_PROFILE: CustomerProfile = {
    name: "Carolina Mejia",
    email: "carolina.mejia@gmail.com",
    phone: "3104567890",
    address: "Calle 127 #15-32 Apto 402",
    city: "Bogotá",
    department: "Cundinamarca",
    cedula: "1018459203",
    notes: "Dejar en portería con vigilancia",
};

export function isSeededProfile(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const p = value as Record<string, unknown>;
    return (Object.keys(SEEDED_PROFILE) as (keyof CustomerProfile)[]).every(
        (k) => p[k] === SEEDED_PROFILE[k],
    );
}

interface PersistedRecord {
    id?: unknown;
    points?: unknown;
    product?: { id?: unknown };
}

type PersistedObject = Record<string, unknown> & {
    orders?: unknown;
    abandonedCarts?: unknown;
    tasks?: unknown;
    launchChecklist?: unknown;
    account?: unknown;
    items?: unknown;
    customerProfile?: unknown;
};

function dropById(list: unknown, ids: Set<string>): unknown {
    if (!Array.isArray(list)) return list;
    return list.filter(
        (entry) =>
            !(
                entry &&
                typeof (entry as PersistedRecord).id === "string" &&
                ids.has((entry as PersistedRecord).id as string)
            ),
    );
}

export function migrateOrdersPersisted(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== "object") return persisted;
    const state = persisted as PersistedObject;
    const next: PersistedObject = { ...state };
    if (state.orders !== undefined) {
        next.orders = dropById(state.orders, SEEDED_ORDER_IDS);
    }
    return next;
}

export function migrateOperatorPersisted(
    persisted: unknown,
    checklistDefaults: { id: string }[],
): unknown {
    if (!persisted || typeof persisted !== "object") return persisted;
    const state = persisted as PersistedObject;
    const next: PersistedObject = { ...state };
    if (state.abandonedCarts !== undefined) {
        next.abandonedCarts = dropById(state.abandonedCarts, SEEDED_ABANDONED_CART_IDS);
    }
    if (state.tasks !== undefined) {
        next.tasks = dropById(state.tasks, SEEDED_TASK_IDS);
    }
    if (Array.isArray(state.launchChecklist)) {
        const defaultsById = new Map(checklistDefaults.map((item) => [item.id, item]));
        next.launchChecklist = state.launchChecklist.map((item) => {
            if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
                const replacement = defaultsById.get((item as { id: string }).id);
                if (replacement) return { ...replacement };
            }
            return item;
        });
    }
    return next;
}

export function migrateLoyaltyPersisted(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== "object") return persisted;
    const state = persisted as PersistedObject;
    const account = state.account;
    if (!account || typeof account !== "object") return persisted;
    const acc = account as Record<string, unknown>;

    const history = Array.isArray(acc.history) ? (acc.history as PersistedRecord[]) : [];
    const removedPoints = history
        .filter(
            (tx) => tx && typeof tx.id === "string" && SEEDED_LOYALTY_TX_IDS.has(tx.id),
        )
        .reduce(
            (sum, tx) =>
                sum + (typeof tx.points === "number" && tx.points > 0 ? tx.points : 0),
            0,
        );
    const keptHistory = history.filter(
        (tx) => !(tx && typeof tx.id === "string" && SEEDED_LOYALTY_TX_IDS.has(tx.id)),
    );

    const points = Math.max(
        0,
        (typeof acc.points === "number" ? acc.points : 0) - removedPoints,
    );
    const lifetimePoints = Math.max(
        0,
        (typeof acc.lifetimePoints === "number" ? acc.lifetimePoints : 0) - removedPoints,
    );

    return {
        ...state,
        account: {
            ...acc,
            points,
            lifetimePoints,
            tier: calculateTier(lifetimePoints),
            history: keptHistory,
            referralCode:
                acc.referralCode === SEEDED_LOYALTY_REFERRAL_CODE ? "" : acc.referralCode,
        },
    };
}

export function migrateCartPersisted(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== "object") return persisted;
    const state = persisted as PersistedObject;
    const next: PersistedObject = { ...state };
    if (Array.isArray(state.items)) {
        next.items = state.items.filter(
            (item) =>
                !(
                    item &&
                    typeof (item as PersistedRecord).product?.id === "string" &&
                    SEEDED_PRODUCT_IDS.has(
                        (item as PersistedRecord).product!.id as string,
                    )
                ),
        );
    }
    if (isSeededProfile(state.customerProfile)) {
        next.customerProfile = { ...BLANK_PROFILE };
    }
    return next;
}
