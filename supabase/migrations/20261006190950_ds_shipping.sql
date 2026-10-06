alter table public.catalog_products add column customer_shipping_cop integer check(customer_shipping_cop >=0), add column shipping_estimate_city text, add column shipping_checked_at timestamptz;

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
    type,
    customer_shipping_cop,
    shipping_estimate_city,
    shipping_checked_at,
    (source in ('aliexpress_ds', 'cjdropshipping')) as shipping_quote_required
from public.catalog_products
where status = 'published';

grant select on public.published_products to anon, authenticated;
