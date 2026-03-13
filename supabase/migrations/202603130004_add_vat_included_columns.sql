alter table if exists public.products
  add column if not exists vat_included boolean not null default false;

alter table if exists public.competitors
  add column if not exists vat_included boolean not null default true;
