-- Reviews (order-linked, moderated), server-backed loyalty, supplier-order fields.

-- ---------- product reviews ----------
create table if not exists public.product_reviews (
    id uuid primary key default gen_random_uuid(),
    product_id text not null references public.catalog_products(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    rating smallint not null check (rating between 1 and 5),
    comment text not null check (char_length(comment) between 1 and 1000),
    reviewer_name text,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (order_id, product_id)
);

alter table public.product_reviews enable row level security;

drop policy if exists product_reviews_select_approved on public.product_reviews;
create policy product_reviews_select_approved on public.product_reviews
    for select to anon, authenticated
    using (status = 'approved');
-- inserts/updates go through service-role API endpoints only
grant select on public.product_reviews to anon, authenticated;
revoke insert, update, delete on public.product_reviews from anon, authenticated;

-- ---------- server-backed loyalty ----------
create table if not exists public.loyalty_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    points integer not null default 0 check (points >= 0),
    lifetime_points integer not null default 0 check (lifetime_points >= 0),
    updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_transactions (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    order_id uuid references public.orders(id) on delete set null,
    kind text not null check (kind in ('earned', 'redeemed', 'restored')),
    points integer not null check (points > 0),
    created_at timestamptz not null default now(),
    -- one award / redemption / restoration per order keeps webhook + admin
    -- retries idempotent
    unique (order_id, kind)
);

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;

-- balances surface through /api/loyalty/balance (service role); no direct
-- client access
revoke all on public.loyalty_accounts from anon, authenticated;
revoke all on public.loyalty_transactions from anon, authenticated;

-- ---------- supplier fulfillment fields ----------
alter table public.orders
    add column if not exists supplier_order_id text,
    add column if not exists supplier_order_status text,
    add column if not exists supplier_order_error text,
    add column if not exists supplier_order_placed_at timestamptz;
