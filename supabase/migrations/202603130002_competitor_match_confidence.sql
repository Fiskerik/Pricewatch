do $$
begin
  if to_regclass('public.competitor_urls') is not null then
    alter table public.competitor_urls
      add column if not exists match_confidence numeric(4,3),
      add column if not exists mismatch_reasons text[] not null default '{}',
      add column if not exists preflight_signals jsonb;

    create index if not exists competitor_urls_match_confidence_idx
      on public.competitor_urls (match_confidence);
  else
    raise notice 'public.competitor_urls does not exist yet; run base schema first, then rerun this migration to add match-confidence columns.';
  end if;
end;
$$;
