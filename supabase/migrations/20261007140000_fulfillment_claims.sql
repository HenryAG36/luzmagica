-- Fulfillment automation: supplier-order sync bookkeeping, refund audit
-- records, and supplier claims for faulty-product evidence/disputes.

-- ---------- order sync bookkeeping ----------
alter table public.orders
    add column if not exists supplier_synced_at timestamptz,
    add column if not exists auto_fulfill_attempts integer not null default 0;

create index if not exists orders_supplier_sync_idx
    on public.orders (supplier_order_status)
    where supplier_order_id is not null;

-- ---------- refund audit ----------
create table if not exists public.refund_requests (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    amount_cop integer not null check (amount_cop > 0),
    reason text not null check (char_length(reason) between 1 and 500),
    status text not null default 'requested'
        check (status in ('requested', 'void_attempted', 'manual_required', 'completed', 'failed')),
    wompi_void_result jsonb,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists refund_requests_order_idx on public.refund_requests (order_id);

alter table public.refund_requests enable row level security;
revoke all on public.refund_requests from anon, authenticated;

-- ---------- supplier claims (faulty-product evidence + disputes) ----------
create table if not exists public.supplier_claims (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    order_item_id bigint not null references public.order_items(id) on delete cascade,
    provider text not null check (provider in ('aliexpress_ds', 'cjdropshipping', 'manual')),
    reason text not null
        check (reason in ('defective', 'damaged', 'wrong_item', 'not_received', 'other')),
    description text not null check (char_length(description) between 10 and 2000),
    evidence_paths text[] not null default '{}',
    status text not null default 'draft'
        check (status in ('draft', 'submitted', 'provider_responded', 'resolved', 'rejected', 'cancelled')),
    provider_dispute_id text,
    provider_status text,
    notes text,
    created_by text not null default 'customer' check (created_by in ('customer', 'operator')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (order_item_id, reason)
);

create index if not exists supplier_claims_status_idx on public.supplier_claims (status);
create index if not exists supplier_claims_order_idx on public.supplier_claims (order_id);

alter table public.supplier_claims enable row level security;
revoke all on public.supplier_claims from anon, authenticated;

-- ---------- evidence storage ----------
-- Private bucket; all reads/writes go through service-role API routes that
-- mint short-lived signed URLs. Nothing is public.
insert into storage.buckets (id, name, public)
values ('claim-evidence', 'claim-evidence', false)
on conflict (id) do nothing;
