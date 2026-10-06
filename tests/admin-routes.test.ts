import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function collectRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...collectRouteFiles(full));
        else if (entry === "route.ts") out.push(full);
    }
    return out;
}

const adminDir = join(import.meta.dirname, "../app/api/admin");
const routeFiles = collectRouteFiles(adminDir);

test("every admin API route independently authorizes via authorizeAdmin", () => {
    assert.ok(routeFiles.length >= 5, "expected admin routes to exist");
    for (const file of routeFiles) {
        const src = readFileSync(file, "utf8");
        assert.ok(src.includes("authorizeAdmin"), `${file} missing authorizeAdmin`);
        assert.ok(src.includes("401") || src.includes("auth.status"), `${file} missing 401 handling`);
    }
});

test("admin API responses never embed provider secrets", () => {
    for (const file of routeFiles) {
        const src = readFileSync(file, "utf8");
        assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY"\s*[,}]/, file);
        const responses = src.match(/NextResponse\.json\(([^)]*)\)/g) || [];
        for (const res of responses) {
            assert.doesNotMatch(res, /token|secret|password/i, `${file} may leak a secret: ${res}`);
        }
    }
});

test("no plaintext password or demo-login paths remain in auth store", () => {
    const store = readFileSync(join(import.meta.dirname, "../store/useAuthStore.ts"), "utf8");
    assert.doesNotMatch(store, /quickDemoLogin/);
    assert.doesNotMatch(store, /SEEDED_USERS/);
    assert.doesNotMatch(store, /admin123|luz123/);
    assert.doesNotMatch(store, /persist\(/);
    assert.match(store, /signInWithPassword/);
});

test("catalog PATCH route sanitizes fields, whitelists actions, and checks origin", () => {
    const src = readFileSync(join(adminDir, "catalog/[id]/route.ts"), "utf8");
    assert.match(src, /sanitizeReviewFields/);
    assert.match(src, /checkOrigin/);
    assert.match(src, /unknown action/);
    assert.match(src, /expectedUpdatedAt/);
    assert.match(src, /publishCatalogProduct/);
    assert.match(src, /updateProduct/);
    assert.match(src, /archiveProduct/);
});
