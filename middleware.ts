import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
    const env = getSupabasePublicEnv();
    const isOperatorRoute = request.nextUrl.pathname.startsWith("/operator");

    if (!env) {
        if (isOperatorRoute) {
            return NextResponse.redirect(new URL("/", request.url));
        }
        return NextResponse.next({ request });
    }

    let response = NextResponse.next({ request });

    const supabase = createServerClient(env.url, env.anonKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                response = NextResponse.next({ request });
                cookiesToSet.forEach(({ name, value, options }) =>
                    response.cookies.set(name, value, options)
                );
            },
        },
    });

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (isOperatorRoute) {
        if (!user) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("redirect", "/operator");
            return NextResponse.redirect(loginUrl);
        }

        const { data: roleRow } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .maybeSingle();

        if (roleRow?.role !== "admin") {
            return NextResponse.redirect(new URL("/", request.url));
        }
    }

    return response;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};
