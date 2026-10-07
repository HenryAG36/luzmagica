import type { SupabaseClientLike } from "../lib/supabase/types.ts";

export interface FakeRow {
    [key: string]: unknown;
}

interface Op {
    kind: "select" | "insert" | "update" | "upsert" | "delete";
    values?: unknown;
    onConflict?: string;
    returning?: boolean;
    filters: { col: string; val: unknown }[];
    neqFilters: { col: string; val: unknown }[];
    inFilters: { col: string; vals: unknown[] }[];
    limitN?: number;
    rangeFrom?: number;
    rangeTo?: number;
    single?: boolean;
    maybe?: boolean;
    columns?: string;
    orderCol?: string;
}

class FakeBuilder implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
    private db: FakeDb;
    private table: string;
    private op: Op;
    constructor(db: FakeDb, table: string, op: Op) {
        this.db = db;
        this.table = table;
        this.op = op;
    }

    select(columns?: string) {
        this.op.returning = true;
        this.op.columns = columns;
        return this;
    }
    insert(values: unknown) {
        this.op = { ...this.op, kind: "insert", values };
        return this;
    }
    update(values: Record<string, unknown>) {
        this.op = { ...this.op, kind: "update", values };
        return this;
    }
    upsert(values: unknown, opts?: { onConflict?: string }) {
        this.op = { ...this.op, kind: "upsert", values, onConflict: opts?.onConflict };
        return this;
    }
    delete() {
        this.op = { ...this.op, kind: "delete" };
        return this;
    }
    eq(col: string, val: unknown) {
        this.op.filters.push({ col, val });
        return this;
    }
    neq(col: string, val: unknown) {
        this.op.neqFilters.push({ col, val });
        return this;
    }
    in(col: string, vals: unknown[]) {
        this.op.inFilters.push({ col, vals });
        return this;
    }
    gt(col: string, val: unknown) {
        this.op.filters.push({ col: `gt:${col}`, val });
        return this;
    }
    lt(col: string, val: unknown) {
        this.op.filters.push({ col: `lt:${col}`, val });
        return this;
    }
    order(col: string) {
        this.op.orderCol = col;
        return this;
    }
    limit(n: number) {
        this.op.limitN = n;
        return this;
    }
    range(from: number, to: number) {
        this.op.rangeFrom = from;
        this.op.rangeTo = to;
        return this;
    }
    single() {
        this.op.single = true;
        return this.exec();
    }
    maybeSingle() {
        this.op.maybe = true;
        return this.exec();
    }

    private matches(row: FakeRow): boolean {
        for (const f of this.op.filters) {
            if (f.col.startsWith("gt:")) {
                if (!(row[f.col.slice(3)] as number > (f.val as number))) return false;
            } else if (f.col.startsWith("lt:")) {
                if (!(row[f.col.slice(3)] as number < (f.val as number))) return false;
            } else if (row[f.col] !== f.val) {
                return false;
            }
        }
        for (const f of this.op.neqFilters) {
            if (row[f.col] === f.val) return false;
        }
        for (const f of this.op.inFilters) {
            if (!f.vals.includes(row[f.col])) return false;
        }
        return true;
    }

    private project(row: FakeRow): FakeRow {
        if (!this.op.columns || this.op.columns === "*") return row;
        const cols = this.op.columns.split(",").map((c) => c.trim());
        const out: FakeRow = {};
        for (const c of cols) out[c] = row[c];
        return out;
    }

    exec(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
        const rows = this.db.table(this.table);
        const op = this.op;
        let result: { data: unknown; error: { message: string; code?: string } | null };

        if (op.kind === "select") {
            if (this.db.failSelects.has(this.table)) {
                return Promise.resolve({ data: null, error: { message: "select failed" } });
            }
            let matched = rows.filter((r) => this.matches(r)).map((r) => this.project(r));
            if (op.orderCol) {
                matched = matched.slice().sort((a, b) => String(a[op.orderCol!]).localeCompare(String(b[op.orderCol!])));
            }
            if (op.rangeFrom !== undefined) {
                matched = matched.slice(op.rangeFrom, (op.rangeTo ?? op.rangeFrom) + 1);
            }
            if (op.limitN !== undefined) matched = matched.slice(0, op.limitN);
            if (op.single) result = { data: matched[0] ?? null, error: matched.length ? null : { message: "no rows", code: "PGRST116" } };
            else if (op.maybe) result = { data: matched[0] ?? null, error: null };
            else result = { data: matched, error: null };
        } else if (op.kind === "insert") {
            const values = (Array.isArray(op.values) ? op.values : [op.values]) as FakeRow[];
            for (const v of values) {
                const conflict = this.db.uniqueKeys(this.table)?.some((cols) =>
                    rows.some((r) => cols.every((c) => r[c] === v[c]))
                );
                if (conflict) {
                    return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });
                }
                rows.push({ ...v });
            }
            result = { data: null, error: null };
        } else if (op.kind === "update" || op.kind === "upsert") {
            const values = op.values as FakeRow;
            let matched: FakeRow[];
            if (op.kind === "upsert") {
                if (this.db.failUpserts.has(this.table)) {
                    return Promise.resolve({ data: null, error: { message: "upsert failed" } });
                }
                const cols = (op.onConflict || "id").split(",");
                const found = rows.find((r) => cols.every((c) => r[c] === values[c]));
                if (found) Object.assign(found, values);
                else rows.push({ ...values });
                matched = [found ?? values];
            } else {
                if (this.db.failUpdates.has(this.table)) {
                    return Promise.resolve({ data: null, error: { message: "update failed" } });
                }
                matched = rows.filter((r) => this.matches(r));
                for (const r of matched) Object.assign(r, values);
            }
            result = { data: op.returning ? matched.map((r) => this.project(r)) : null, error: null };
        } else {
            const matched = rows.filter((r) => this.matches(r));
            for (const r of matched) rows.splice(rows.indexOf(r), 1);
            result = { data: op.returning ? matched : null, error: null };
        }

        this.db.ops.push({ table: this.table, kind: op.kind });
        return Promise.resolve(result);
    }

    then<TResult1 = { data: unknown; error: { message: string; code?: string } | null }, TResult2 = never>(
        onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
        if (this.op.kind === "select" || (this.op.kind !== "insert" && !this.op.values && this.op.kind !== "delete")) {
            if (!this.op.kind) this.op.kind = "select";
        }
        return this.exec().then(onfulfilled, onrejected);
    }
}

export class FakeDb {
    tables: Record<string, FakeRow[]> = {};
    ops: { table: string; kind: string }[] = [];
    rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    unique: Record<string, string[][]> = {};
    failUpdates: Set<string> = new Set();
    failUpserts: Set<string> = new Set();
    failSelects: Set<string> = new Set();
    leases: Map<string, { owner: string; expiresAt: number }> = new Map();
    nowMs: () => number = () => Date.now();

    table(name: string): FakeRow[] {
        if (!this.tables[name]) this.tables[name] = [];
        return this.tables[name];
    }

    uniqueKeys(table: string): string[][] {
        return this.unique[table] ?? [];
    }

    asClient(): SupabaseClientLike {
        const client = {
            auth: undefined as never,
            from: (table: string) =>
                new FakeBuilder(this, table, {
                    kind: "select",
                    filters: [],
                    neqFilters: [],
                    inFilters: [],
                }),
            rpc: (fn: string, args?: Record<string, unknown>) => {
                this.rpcCalls.push({ fn, args: args ?? {} });
                if (fn === "try_acquire_refresh_lease") {
                    const key = `${args?.p_source}:${args?.p_scope}`;
                    const existing = this.leases.get(key);
                    const now = this.nowMs();
                    if (existing && existing.expiresAt > now) {
                        return Promise.resolve({ data: false, error: null });
                    }
                    this.leases.set(key, {
                        owner: String(args?.p_owner),
                        expiresAt: now + Number(args?.p_ttl_seconds) * 1000,
                    });
                    return Promise.resolve({ data: true, error: null });
                }
                if (fn === "release_refresh_lease") {
                    const key = `${args?.p_source}:${args?.p_scope}`;
                    const existing = this.leases.get(key);
                    if (existing && existing.owner === String(args?.p_owner)) this.leases.delete(key);
                    return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
            },
        };
        return client as unknown as SupabaseClientLike;
    }
}
