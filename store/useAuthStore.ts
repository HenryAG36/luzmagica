"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { UserAccount, UserRole } from "@/lib/types";
import { useCartStore } from "./useCartStore";

interface AuthState {
    users: UserAccount[];
    currentUser: UserAccount | null;
    isAuthenticated: boolean;

    login: (email: string, password: string) => { success: boolean; message: string; user?: UserAccount };
    register: (
        data: Omit<UserAccount, "id" | "createdAt">
    ) => { success: boolean; message: string; user?: UserAccount };
    logout: () => void;
    updateProfile: (data: Partial<UserAccount>) => void;
    quickDemoLogin: (role: UserRole) => UserAccount;
}

const SEEDED_USERS: UserAccount[] = [
    {
        id: "usr-admin-1",
        email: "admin@luzmagica.co",
        password: "admin123",
        role: "admin",
        name: "Henry Admin",
        phone: "3109998877",
        cedula: "1098765432",
        address: "Cra 7 #71-21 Torre A",
        city: "Bogotá",
        department: "Cundinamarca",
        createdAt: "2026-09-01",
    },
    {
        id: "usr-cust-1",
        email: "carolina.mejia@gmail.com",
        password: "luz123",
        role: "customer",
        name: "Carolina Mejía",
        phone: "3104567890",
        cedula: "1018459203",
        address: "Calle 127 #15-32 Apto 402",
        city: "Bogotá",
        department: "Cundinamarca",
        createdAt: "2026-09-15",
    },
];

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            users: SEEDED_USERS,
            currentUser: null,
            isAuthenticated: false,

            login: (email: string, password: string) => {
                const cleanEmail = email.trim().toLowerCase();
                const user = get().users.find((u) => u.email.toLowerCase() === cleanEmail);

                if (!user) {
                    return { success: false, message: "No encontramos ninguna cuenta con ese correo electrónico." };
                }

                if (user.password !== password) {
                    return { success: false, message: "Contraseña incorrecta. Por favor verifica tus datos." };
                }

                set({ currentUser: user, isAuthenticated: true });

                // Sync customer profile with cart store for instant checkout
                useCartStore.getState().setCustomerProfile({
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    address: user.address,
                    city: user.city,
                    cedula: user.cedula,
                    department: user.department,
                });

                return { success: true, message: `¡Bienvenido de nuevo, ${user.name}!`, user };
            },

            register: (data) => {
                const cleanEmail = data.email.trim().toLowerCase();
                const existing = get().users.find((u) => u.email.toLowerCase() === cleanEmail);

                if (existing) {
                    return { success: false, message: "Ya existe una cuenta registrada con este correo electrónico." };
                }

                const newUser: UserAccount = {
                    ...data,
                    id: `usr-${Date.now()}`,
                    email: cleanEmail,
                    createdAt: new Date().toISOString().split("T")[0],
                };

                const updatedUsers = [...get().users, newUser];
                set({
                    users: updatedUsers,
                    currentUser: newUser,
                    isAuthenticated: true,
                });

                useCartStore.getState().setCustomerProfile({
                    name: newUser.name,
                    email: newUser.email,
                    phone: newUser.phone,
                    address: newUser.address,
                    city: newUser.city,
                    cedula: newUser.cedula,
                    department: newUser.department,
                });

                return { success: true, message: "¡Cuenta creada exitosamente!", user: newUser };
            },

            logout: () => {
                set({ currentUser: null, isAuthenticated: false });
            },

            updateProfile: (data) => {
                const current = get().currentUser;
                if (!current) return;

                const updated: UserAccount = { ...current, ...data };
                const updatedUsers = get().users.map((u) => (u.id === current.id ? updated : u));

                set({ currentUser: updated, users: updatedUsers });

                useCartStore.getState().setCustomerProfile({
                    name: updated.name,
                    email: updated.email,
                    phone: updated.phone,
                    address: updated.address,
                    city: updated.city,
                    cedula: updated.cedula,
                    department: updated.department,
                });
            },

            quickDemoLogin: (role: UserRole) => {
                const target = get().users.find((u) => u.role === role) || SEEDED_USERS.find((u) => u.role === role)!;
                set({ currentUser: target, isAuthenticated: true });

                useCartStore.getState().setCustomerProfile({
                    name: target.name,
                    email: target.email,
                    phone: target.phone,
                    address: target.address,
                    city: target.city,
                    cedula: target.cedula,
                    department: target.department,
                });

                return target;
            },
        }),
        {
            name: "luzmagica-auth-v1",
        }
    )
);
