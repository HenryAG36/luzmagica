-- Research-only providers cannot supply the public catalog. Keep their rows
-- and historical order snapshots intact. Mastershop is the only importable
-- supplier; its rows require a confirmed city shipping quote before publish.
create or replace view public.published_products as
select
    id, name, price_cop, original_price_cop, category, room, images, badge,
    description, stock, type, customer_shipping_cop, shipping_estimate_city,
    shipping_checked_at,
    (source = 'mastershop') as shipping_quote_required
from public.catalog_products
where status = 'published'
  and source not in ('aliexpress', 'aliexpress_ds', 'cjdropshipping')
  and (
    source <> 'mastershop'
    or (
      customer_shipping_cop is not null
      and customer_shipping_cop >= 0
      and shipping_estimate_city is not null
      and btrim(shipping_estimate_city) <> ''
      and shipping_checked_at is not null
    )
  );

grant select on public.published_products to anon, authenticated;
