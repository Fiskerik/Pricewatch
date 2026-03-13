alter table if exists public.competitor_urls
  add column if not exists match_confidence numeric(4,3),
  add column if not exists mismatch_reasons text[] not null default '{}',
  add column if not exists preflight_signals jsonb;

create index if not exists competitor_urls_match_confidence_idx
  on public.competitor_urls (match_confidence);
