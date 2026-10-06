"use client";

import { create } from "zustand";
import type { UserAccount, UserRole } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SupabaseClientLike } from "@/lib/supabase/types";
import { useCartStore } from "./useCartStore";

interface RegisterCustomerData {
    name: string;
    email: string;
    password: string;
    phone: string;
    cedula: string;
    address: string;
    city: string;
    department?: string;
    referralCode?: string;
}

interface AuthResult {
    success: boolean;
    message: string;
    user?: UserAccount;
}

interface AuthState {
    currentUser: UserAccount | null;
    isAuthenticated: boolean;
    authReady: boolean;

    initialize: () => Promise<void>;
    login: (email: string, password: string) => Promise<AuthResult>;
    registerCustomer: (data: RegisterCustomerData) => Promise<AuthResult>;
    logout: () => Promise<AuthResult>;
    updateProfile: (data: Partial<UserAccount>) => Promise<AuthResult>;
}

interface ProfileRow {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    cedula: string | null;
    address: string | null;
    city: string | null;
    department: string | null;
    created_at: string;
}

async function loadAccount(
    supabase: SupabaseClientLike,
    userId: string,
    email: string,
    createdAt: string
): Promise<UserAccount | null> {
    const { data: profileData } = await supabase
        .from("profiles")
        .select("id,email,name,phone,cedula,address,city,department,created_at")
        .eq("id", userId)
        .maybeSingle();
    const profile = profileData as ProfileRow | null;

    const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
    const roleRow = roleData as { role: UserRole } | null;

    if (!profile && !roleRow) return null;

    const account: UserAccount = {
        id: userId,
        email: profile?.email || email,
        role: roleRow?.role === "admin" ? "admin" : "customer",
        name: profile?.name || email.split("@")[0] || "Usuario",
        phone: profile?.phone || "",
        cedula: profile?.cedula || "",
        address: profile?.address || "",
        city: profile?.city || "",
        department: profile?.department || undefined,
        createdAt: (profile?.created_at || createdAt || "").split("T")[0],
    };

    // Sync customer profile with cart store for instant checkout
    useCartStore.getState().setCustomerProfile({
        name: account.name,
        email: account.email,
        phone: account.phone,
        address: account.address,
        city: account.city,
        cedula: account.cedula,
        department: account.department,
    });

    return account;
}

let initialized = false;
let sessionEpoch = 0;

function clearLegacyAuthStorage() {
    try {
        localStorage.removeItem("luzmagica-auth-v2");
        localStorage.removeItem("luzmagica-auth-v1");
        localStorage.removeItem("luzmagica-auth");
    } catch {
    }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
    currentUser: null,
    isAuthenticated: false,
    authReady: false,

    initialize: async () => {
        if (initialized) return;
        initialized = true;
        clearLegacyAuthStorage();

        try {
            const supabase = getSupabaseBrowserClient();
            if (!supabase) {
                set({ authReady: true });
                return;
            }

            const { data } = await supabase.auth.getSession();
            const session = data.session;
            if (session?.user) {
                const epoch = sessionEpoch;
                const account = await loadAccount(supabase, session.user.id, session.user.email || "", session.user.created_at);
                if (epoch === sessionEpoch) {
                    set({ currentUser: account, isAuthenticated: !!account });
                }
            }

            supabase.auth.onAuthStateChange((event, nextSession) => {
                setTimeout(() => {
                    if (event === "SIGNED_OUT" || !nextSession?.user) {
                        sessionEpoch++;
                        set({ currentUser: null, isAuthenticated: false });
                        return;
                    }
                    const epoch = sessionEpoch;
                    const nextUser = nextSession.user;
                    loadAccount(
                        supabase,
                        nextUser.id,
                        nextUser.email || "",
                        nextUser.created_at
                    ).then((account) => {
                        if (epoch !== sessionEpoch) return;
                        const current = get().currentUser;
                        if (event === "SIGNED_IN" || event === "USER_UPDATED" || account?.role !== current?.role || !current) {
                            set({ currentUser: account, isAuthenticated: !!account });
                        }
                    }).catch(() => {
                    });
                }, 0);
            });
        } catch {
        } finally {
            set({ authReady: true });
        }
    },

    login: async (email, password) => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
            return { success: false, message: "La autenticación no está configurada en este entorno." };
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
        });

        if (error || !data.user) {
            return {
                success: false,
                message: "Correo o contraseña incorrectos. Por favor verifica tus datos.",
            };
        }

        const epoch = sessionEpoch;
        const account = await loadAccount(supabase, data.user.id, data.user.email || "", data.user.created_at);
        if (epoch !== sessionEpoch) {
            return { success: false, message: "La sesión cambió durante el inicio. Intenta de nuevo." };
        }
        if (!account) {
            return { success: false, message: "No pudimos cargar tu perfil. Intenta de nuevo." };
        }

        set({ currentUser: account, isAuthenticated: true });
        return {
            success: true,
            message: `¡Bienvenido de nuevo, ${account.name}! (${account.role === "admin" ? "Administrador" : "Cliente"})`,
            user: account,
        };
    },

    registerCustomer: async (data) => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
            return { success: false, message: "El registro no está configurado en este entorno." };
        }

        // Public registration ALWAYS creates role: 'customer'
        const { data: signUpData, error } = await supabase.auth.signUp({
            email: data.email.trim().toLowerCase(),
            password: data.password,
            options: {
                data: {
                    name: data.name,
                    phone: data.phone,
                    cedula: data.cedula,
                    address: data.address,
                    city: data.city,
                    department: data.department || "Colombia",
                    referral_code: data.referralCode || null,
                },
            },
        });

        if (error) {
            const duplicate = /already registered|already exists|duplicate/i.test(error.message);
            return {
                success: false,
                message: duplicate
                    ? "Ya existe una cuenta registrada con este correo electrónico."
                    : "No pudimos crear tu cuenta. Intenta de nuevo.",
            };
        }

        if (!signUpData.user) {
            return { success: false, message: "No pudimos crear tu cuenta. Intenta de nuevo." };
        }

        if (signUpData.session) {
            const epoch = sessionEpoch;
            const account = await loadAccount(
                supabase,
                signUpData.user.id,
                signUpData.user.email || data.email,
                signUpData.user.created_at
            );
            if (account && epoch === sessionEpoch) {
                set({ currentUser: account, isAuthenticated: true });
                return { success: true, message: "¡Cuenta de cliente creada exitosamente!", user: account };
            }
        }

        return {
            success: true,
            message: "¡Cuenta creada! Revisa tu correo para confirmar el registro antes de iniciar sesión.",
        };
    },

    logout: async () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
            sessionEpoch++;
            set({ currentUser: null, isAuthenticated: false });
            return { success: true, message: "Sesión cerrada." };
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
            return { success: false, message: "No se pudo cerrar la sesión. Intenta de nuevo." };
        }
        sessionEpoch++;
        set({ currentUser: null, isAuthenticated: false });
        return { success: true, message: "Sesión cerrada." };
    },

    updateProfile: async (data) => {
        const supabase = getSupabaseBrowserClient();
        const current = get().currentUser;
        if (!supabase || !current) {
            return { success: false, message: "No hay una sesión activa." };
        }

        const update: Record<string, unknown> = {};
        if (data.name !== undefined) update.name = data.name;
        if (data.phone !== undefined) update.phone = data.phone;
        if (data.cedula !== undefined) update.cedula = data.cedula;
        if (data.address !== undefined) update.address = data.address;
        if (data.city !== undefined) update.city = data.city;
        if (data.department !== undefined) update.department = data.department;

        const { error } = await supabase
            .from("profiles")
            .update(update)
            .eq("id", current.id);

        if (error) {
            return { success: false, message: "No pudimos actualizar tu perfil." };
        }

        const epoch = sessionEpoch;
        const account = await loadAccount(supabase, current.id, current.email, "");
        if (epoch === sessionEpoch) {
            set({ currentUser: account || { ...current, ...data, role: current.role } });
        }
        return { success: true, message: "Datos actualizados correctamente." };
    },
}));
