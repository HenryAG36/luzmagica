import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/lib/auth/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
    const auth = await authorizeAdmin();
    if (!auth.ok) {
        return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
    }

    const { id } = await context.params;
    if (id === auth.user.id) {
        return NextResponse.json({ error: "No puedes eliminar tu propia cuenta en uso." }, { status: 400 });
    }

    const service = getServiceRoleClient();
    if (!service) {
        return NextResponse.json({ error: "service unavailable" }, { status: 503 });
    }

    const { data: target } = await service
        .from("user_roles")
        .select("role")
        .eq("user_id", id)
        .maybeSingle();

    if (!target || (target as { role: string }).role !== "admin") {
        return NextResponse.json({ error: "Administrador no encontrado." }, { status: 404 });
    }

    const { error: roleError } = await service
        .from("user_roles")
        .update({ role: "customer" })
        .eq("user_id", id)
        .eq("role", "admin");

    if (roleError) {
        const isLastAdmin = /last administrator/i.test(roleError.message);
        return NextResponse.json(
            { error: isLastAdmin ? "No puedes revocar el acceso del único administrador del sistema." : roleError.message },
            { status: isLastAdmin ? 400 : 500 }
        );
    }

    return NextResponse.json({ ok: true });
}
