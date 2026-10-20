-- Mastershop COD phase: payment method + idempotent checkout attempt on
-- orders, widened status checks, the COD capability flag in the public view,
-- and an atomic order+items+event RPC for cash-on-delivery checkout.

alter table public.orders
    add column if not exists payment_method text not null default 'wompi',
    add column if not exists checkout_attempt_id uuid,
    add column if not exists mastershop_status text;

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
    check (payment_method in ('wompi', 'cash_on_delivery'));

-- Multiple NULLs are allowed; a present attempt id is globally unique.
alter table public.orders drop constraint if exists orders_checkout_attempt_id_key;
alter table public.orders add constraint orders_checkout_attempt_id_key
    unique (checkout_attempt_id);

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
    check (payment_status in ('pending_payment','paid','payment_failed','payment_review','cod_pending','cancelled','refunded'));

alter table public.orders drop constraint if exists orders_fulfillment_status_check;
alter table public.orders add constraint orders_fulfillment_status_check
    check (fulfillment_status in ('awaiting_payment','payment_confirmed','awaiting_confirmation','supplier_processing','international_transit','customs_cleared','domestic_transit','local_delivery','delivered','cancelled'));

-- COD orders never carry gateway artifacts and can only be pending collection
-- or cancelled — no undocumented money state is representable.
alter table public.orders drop constraint if exists orders_cod_consistency_check;
alter table public.orders add constraint orders_cod_consistency_check
    check (
        payment_method <> 'cash_on_delivery'
        or (
            payment_link_id is null
            and payment_link_url is null
            and wompi_transaction_id is null
            and payment_status in ('cod_pending', 'cancelled')
        )
    );

-- Public capability flag: Mastershop products may be offered COD (the app
-- still validates source, membership, stock and weight server-side).
create or replace view public.published_products as
select
    id, name, price_cop, original_price_cop, category, room, images, badge,
    description, stock, type, customer_shipping_cop, shipping_estimate_city,
    shipping_checked_at,
    (source = 'mastershop') as shipping_quote_required,
    (source = 'mastershop') as cash_on_delivery_eligible
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

-- Atomic COD order creation: advisory-locked per phone then per attempt so
-- concurrent identical checkouts converge on one row; reused attempts are
-- fingerprint-compared; item/totals are recomputed server-side; any failure
-- rolls the whole transaction back.
create or replace function public.create_cod_order(p_order jsonb, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    existing public.orders%rowtype;
    created public.orders%rowtype;
    item jsonb;
    subtotal bigint;
    shipping bigint;
    cod_phone text;
    recent_count integer;
begin
    if jsonb_typeof(p_order) is distinct from 'object'
       or nullif(btrim(coalesce(p_order->>'checkout_attempt_id', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'id', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'ref', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'lookup_token', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'customer_name', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'customer_email', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'customer_phone', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'customer_cedula', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'address', '')), '') is null
       or nullif(btrim(coalesce(p_order->>'city', '')), '') is null
       or (p_order->>'consent_at') is null then
        raise exception 'invalid order';
    end if;

    -- Generated secrets must match the formats the app produces: a 64-hex
    -- sha256 fingerprint and a 64-hex random lookup token.
    if p_order->>'cart_fingerprint' is null
       or (p_order->>'cart_fingerprint') !~ '^[0-9a-f]{64}$'
       or p_order->>'lookup_token' is null
       or (p_order->>'lookup_token') !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid order';
    end if;

    cod_phone := p_order->>'customer_phone';

    -- Lock order is fixed everywhere: phone first, attempt second.
    perform pg_advisory_xact_lock(hashtextextended('cod-phone:' || cod_phone, 0));
    perform pg_advisory_xact_lock(hashtextextended((p_order->>'checkout_attempt_id')::uuid::text, 0));

    select * into existing from public.orders
     where checkout_attempt_id = (p_order->>'checkout_attempt_id')::uuid;
    if found then
        if existing.cart_fingerprint is distinct from p_order->>'cart_fingerprint' then
            raise exception 'checkout attempt changed';
        end if;
        return jsonb_build_object('order', to_jsonb(existing), 'reused', true);
    end if;

    -- <=3 new COD orders per phone per hour; reused attempts bypass the count.
    select count(*) into recent_count from public.orders
     where customer_phone = cod_phone
       and payment_method = 'cash_on_delivery'
       and created_at >= now() - interval '1 hour';
    if recent_count >= 3 then
        raise exception 'too many requests';
    end if;

    if jsonb_typeof(p_items) is distinct from 'array'
       or jsonb_array_length(p_items) not between 1 and 20 then
        raise exception 'invalid items';
    end if;

    subtotal := 0;
    shipping := 0;
    for item in select value from jsonb_array_elements(p_items) loop
        -- Strict integers only: a JSON string, float or boolean must not be
        -- silently rounded into a valid amount by the cast.
        if jsonb_typeof(item) is distinct from 'object'
           or item->>'source' is distinct from 'mastershop'
           or nullif(btrim(coalesce(item->>'product_id', '')), '') is null
           or nullif(btrim(coalesce(item->>'name', '')), '') is null
           or jsonb_typeof(item->'quantity') is distinct from 'number'
           or (item->>'quantity') !~ '^[0-9]+$'
           or (item->>'quantity')::integer not between 1 and 20
           or jsonb_typeof(item->'unit_price_cop') is distinct from 'number'
           or (item->>'unit_price_cop') !~ '^[0-9]+$'
           or (item->>'unit_price_cop')::integer <= 0
           or jsonb_typeof(item->'unit_shipping_cop') is distinct from 'number'
           or (item->>'unit_shipping_cop') !~ '^[0-9]+$' then
            raise exception 'invalid COD item';
        end if;
        subtotal := subtotal + (item->>'unit_price_cop')::integer::bigint * (item->>'quantity')::integer;
        shipping := shipping + (item->>'unit_shipping_cop')::integer::bigint * (item->>'quantity')::integer;
    end loop;

    if jsonb_typeof(p_order->'subtotal_cop') is distinct from 'number'
       or jsonb_typeof(p_order->'shipping_cop') is distinct from 'number'
       or jsonb_typeof(p_order->'total_cop') is distinct from 'number'
       or (p_order->>'subtotal_cop') !~ '^-?[0-9]+$'
       or (p_order->>'shipping_cop') !~ '^-?[0-9]+$'
       or (p_order->>'total_cop') !~ '^-?[0-9]+$'
       or subtotal is distinct from (p_order->>'subtotal_cop')::bigint
       or shipping is distinct from (p_order->>'shipping_cop')::bigint
       or subtotal + shipping is distinct from (p_order->>'total_cop')::bigint then
        raise exception 'invalid COD totals';
    end if;

    insert into public.orders(
        id, ref, lookup_token, cart_fingerprint, checkout_attempt_id,
        customer_name, customer_email, customer_phone, customer_cedula,
        address, city, department, notes,
        subtotal_cop, discount_cop, shipping_cop, total_cop,
        payment_method, payment_status, fulfillment_status,
        consent_at, supplier_order_status
    ) values (
        (p_order->>'id')::uuid, p_order->>'ref', p_order->>'lookup_token',
        p_order->>'cart_fingerprint', (p_order->>'checkout_attempt_id')::uuid,
        p_order->>'customer_name', p_order->>'customer_email', p_order->>'customer_phone',
        p_order->>'customer_cedula',
        p_order->>'address', p_order->>'city', p_order->>'department', p_order->>'notes',
        subtotal, 0, shipping, subtotal + shipping,
        'cash_on_delivery', 'cod_pending', 'awaiting_confirmation',
        (p_order->>'consent_at')::timestamptz, 'queued'
    ) returning * into created;

    insert into public.order_items(
        order_id, product_id, name, unit_price_cop, quantity,
        unit_shipping_cop, unit_supplier_cost_cop, source, supplier_variant
    )
    select created.id, x.product_id, x.name, x.unit_price_cop, x.quantity,
           x.unit_shipping_cop, x.unit_supplier_cost_cop, x.source, x.supplier_variant
      from jsonb_to_recordset(p_items) as x(
        product_id text, name text, unit_price_cop integer, quantity integer,
        unit_shipping_cop integer, unit_supplier_cost_cop integer,
        source text, supplier_variant jsonb);

    insert into public.order_events(order_id, kind, status, label, description)
    values (
        created.id, 'payment', 'cod_pending',
        'Pedido contraentrega registrado',
        'Paga al recibir. El recaudo y la liquidación todavía no se han verificado.'
    );

    return jsonb_build_object('order', to_jsonb(created), 'reused', false);
end;
$$;

revoke all on function public.create_cod_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(jsonb, jsonb) to service_role;
