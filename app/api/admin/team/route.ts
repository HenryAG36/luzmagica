import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

interface RoleRow {
    user_id: string;
    role: string;
    created_at: string;
}

interface ProfileRow {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    created_at: string;
}

export async function GET() {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const { data: adminRoles } = await service
        .from("user_roles")
        .select("user_id,role,created_at")
        .eq("role", "admin");

    const { data: customerRoles } = await service
        .from("user_roles")
        .select("user_id")
        .eq("role", "customer");

    const roleRows = (adminRoles ?? []) as RoleRow[];
    const adminIds = roleRows.map((r) => r.user_id);
    const { data: profiles } = adminIds.length
        ? await service
              .from("profiles")
              .select("id,email,name,phone,created_at")
              .in("id", adminIds)
        : { data: [] as ProfileRow[] };

    const profileById = new Map(((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]));
    const admins = roleRows.map((r) => ({
        id: r.user_id,
        email: profileById.get(r.user_id)?.email || "",
        name: profileById.get(r.user_id)?.name || "",
        phone: profileById.get(r.user_id)?.phone || "",
        createdAt: (r.created_at || "").split("T")[0],
    }));

    return NextResponse.json({ admins, customerCount: customerRoles?.length ?? 0 });
}

export async function POST(request: Request) {
    // Security check: Only an active admin can create other admin accounts
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const phone = typeof body.phone === "string" ? body.phone : "";

    if (!name || !email || password.length < 6) {
        return NextResponse.json(
            { error: "Nombre, correo y una contraseña de al menos 6 caracteres son obligatorios." },
            { status: 400 }
        );
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, phone },
    });

    if (createError || !created.user) {
        return NextResponse.json(
            { error: "No se pudo crear la cuenta. Es posible que el correo ya esté registrado." },
            { status: 400 }
        );
    }

    const { error: roleError } = await service
        .from("user_roles")
        .upsert({ user_id: created.user.id, role: "admin", granted_by: auth.user.id });

    if (roleError) {
        await service.auth.admin.deleteUser(created.user.id);
        return NextResponse.json({ error: "No se pudo asignar el rol de administrador." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: created.user.id });
}
