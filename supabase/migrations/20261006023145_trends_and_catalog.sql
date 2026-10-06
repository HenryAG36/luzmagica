create table if not exists public.provider_connections (
    provider text primary key check (provider in ('mercadolibre', 'aliexpress')),
    status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
    access_token_encrypted text,
    refresh_token_encrypted text,
    token_expires_at timestamptz,
    scopes text,
    meta jsonb not null default '{}'::jsonb,
    connected_by uuid references auth.users(id),
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.trend_snapshots (
    source text not null,
    scope text not null,
    payload jsonb not null default '{}'::jsonb,
    fetched_at timestamptz not null default now(),
    expires_at timestamptz not null,
    last_attempt_at timestamptz,
    next_refresh_at timestamptz,
    error text,
    created_at timestamptz not null default now(),
    primary key (source, scope)
);

create table if not exists public.refresh_leases (
    source text not null,
    scope text not null,
    lease_owner text not null,
    acquired_at timestamptz not null default now(),
    expires_at timestamptz not null,
    primary key (source, scope)
);

create or replace function public.try_acquire_refresh_lease(
    p_source text,
    p_scope text,
    p_owner text,
    p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.refresh_leases (source, scope, lease_owner, acquired_at, expires_at)
    values (p_source, p_scope, p_owner, now(), now() + make_interval(secs => p_ttl_seconds))
    on conflict (source, scope) do update
        set lease_owner = excluded.lease_owner,
            acquired_at = excluded.acquired_at,
            expires_at = excluded.expires_at
        where public.refresh_leases.expires_at < now();
    return found;
end;
$$;

create or replace function public.release_refresh_lease(
    p_source text,
    p_scope text,
    p_owner text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.refresh_leases
    where source = p_source and scope = p_scope and lease_owner = p_owner;
end;
$$;

revoke all on function public.try_acquire_refresh_lease(text,text,text,integer) from public, anon, authenticated;
grant execute on function public.try_acquire_refresh_lease(text,text,text,integer) to service_role;
revoke all on function public.release_refresh_lease(text,text,text) from public, anon, authenticated;
grant execute on function public.release_refresh_lease(text,text,text) to service_role;

create table if not exists public.catalog_products (
    id text primary key,
    source text not null default 'seed',
    provider_item_id text,
    source_url text,
    name text not null,
    price_cop integer not null check (price_cop >= 0),
    original_price_cop integer check (original_price_cop >= 0),
    category text not null default '',
    room text not null default '',
    images text[] not null default '{}',
    badge text check (badge in ('sale', 'new')),
    description text not null default '',
    stock integer not null default 0 check (stock >= 0),
    type text not null default '',
    listing_price numeric,
    listing_currency text,
    supplier_cost_cop integer check (supplier_cost_cop >= 0),
    supplier_shipping_cop integer check (supplier_shipping_cop >= 0),
    taxes_fees_cop integer check (taxes_fees_cop >= 0),
    fx_rate numeric,
    fx_rate_date date,
    supplier_rights_confirmed boolean not null default false,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    created_by uuid references auth.users(id),
    reviewed_by uuid references auth.users(id),
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source, provider_item_id)
);

create or replace view public.published_products as
select
    id,
    name,
    price_cop,
    original_price_cop,
    category,
    room,
    images,
    badge,
    description,
    stock,
    type
from public.catalog_products
where status = 'published';

alter table public.provider_connections enable row level security;
alter table public.trend_snapshots enable row level security;
alter table public.refresh_leases enable row level security;
alter table public.catalog_products enable row level security;

drop policy if exists provider_connections_admin_read on public.provider_connections;
create policy provider_connections_admin_read on public.provider_connections
    for select using (public.is_admin());

drop policy if exists trend_snapshots_admin_read on public.trend_snapshots;
create policy trend_snapshots_admin_read on public.trend_snapshots
    for select using (public.is_admin());

drop policy if exists catalog_products_admin_all on public.catalog_products;
create policy catalog_products_admin_all on public.catalog_products
    for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.provider_connections from anon, authenticated;
revoke all on public.trend_snapshots from anon, authenticated;
revoke all on public.refresh_leases from anon, authenticated;
revoke all on public.catalog_products from anon, authenticated;
grant select on public.provider_connections to authenticated;
grant select on public.trend_snapshots to authenticated;
grant select on public.published_products to anon, authenticated;
