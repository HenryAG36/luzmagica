create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    ref text not null unique,
    lookup_token text not null unique,
    cart_fingerprint text not null default '',
    customer_name text not null,
    customer_email text not null,
    customer_phone text not null,
    customer_cedula text not null,
    address text not null,
    city text not null,
    department text,
    notes text,
    subtotal_cop integer not null check (subtotal_cop >= 0),
    discount_cop integer not null default 0 check (discount_cop >= 0),
    shipping_cop integer not null default 0 check (shipping_cop >= 0),
    total_cop integer not null check (total_cop >= 0),
    coupon_code text,
    payment_status text not null default 'pending_payment'
        check (payment_status in ('pending_payment','paid','payment_failed','payment_review','cancelled','refunded')),
    fulfillment_status text not null default 'awaiting_payment'
        check (fulfillment_status in ('awaiting_payment','payment_confirmed','supplier_processing','international_transit','customs_cleared','local_delivery','delivered','cancelled')),
    payment_link_id text,
    payment_link_url text,
    wompi_transaction_id text,
    tracking_number text,
    carrier text,
    review jsonb,
    consent_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
    id bigint generated always as identity primary key,
    order_id uuid not null references public.orders(id) on delete cascade,
    product_id text not null,
    name text not null,
    unit_price_cop integer not null check (unit_price_cop >= 0),
    quantity integer not null check (quantity > 0),
    unit_shipping_cop integer not null default 0 check (unit_shipping_cop >= 0),
    unit_supplier_cost_cop integer,
    source text not null default 'manual',
    supplier_variant jsonb
);

create table if not exists public.order_events (
    id bigint generated always as identity primary key,
    order_id uuid not null references public.orders(id) on delete cascade,
    kind text not null check (kind in ('payment','fulfillment','note')),
    status text not null,
    label text not null,
    description text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.payment_events (
    id bigint generated always as identity primary key,
    provider text not null default 'wompi',
    transaction_id text not null,
    order_id uuid references public.orders(id) on delete set null,
    status text not null,
    amount_in_cents bigint,
    checksum text,
    payload jsonb,
    processed_at timestamptz not null default now(),
    unique (provider, transaction_id, status)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.payment_events enable row level security;

create index if not exists orders_customer_phone_idx on public.orders (customer_phone);
create index if not exists orders_payment_status_idx on public.orders (payment_status);
create index if not exists orders_payment_link_idx on public.orders (payment_link_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_events_order_id_idx on public.order_events (order_id);
