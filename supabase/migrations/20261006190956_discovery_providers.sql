alter table public.provider_connections drop constraint provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check check(provider in ('mercadolibre','aliexpress','aliexpress_ds','cjdropshipping'));
