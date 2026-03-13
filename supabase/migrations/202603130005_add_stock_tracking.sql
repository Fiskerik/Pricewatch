do $$
begin
  if to_regclass('public.competitor_urls') is not null then
    alter table public.competitor_urls
      add column if not exists last_stock_status text,
      add column if not exists last_stock_changed_at timestamptz;

    create index if not exists competitor_urls_last_stock_status_idx
      on public.competitor_urls (last_stock_status);
  else
    raise notice 'public.competitor_urls does not exist yet; run base schema first, then rerun this migration to add stock tracking columns.';
  end if;

  if to_regclass('public.alerts_sent') is not null then
    alter table public.alerts_sent
      add column if not exists alert_type text not null default 'price_change';
  else
    raise notice 'public.alerts_sent does not exist yet; run base schema first, then rerun this migration to add alert_type.';
  end if;
end $$;
