alter table if exists public.products
  add column if not exists auto_price_enabled boolean not null default false,
  add column if not exists auto_price_undercut_type text,
  add column if not exists auto_price_undercut_value numeric,
  add column if not exists auto_price_applied numeric,
  add column if not exists last_auto_priced_at timestamptz,
  add column if not exists shopify_variant_id text;

alter table if exists public.products
  drop constraint if exists products_auto_price_undercut_type_check;

alter table if exists public.products
  add constraint products_auto_price_undercut_type_check
  check (auto_price_undercut_type in ('percent', 'fixed') or auto_price_undercut_type is null);
