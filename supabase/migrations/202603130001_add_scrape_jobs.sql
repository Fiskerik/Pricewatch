create table if not exists public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('queued', 'processing', 'retrying', 'success', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  failure_reason_code text check (failure_reason_code in ('timeout', 'blocked', 'parse_fail', 'no_candidate')),
  domain text not null,
  platform text,
  competitor_url_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scrape_jobs_status_next_attempt_idx
  on public.scrape_jobs (status, next_attempt_at);

create index if not exists scrape_jobs_domain_platform_idx
  on public.scrape_jobs (domain, platform);

create index if not exists scrape_jobs_competitor_url_idx
  on public.scrape_jobs (competitor_url_id);

do $$
begin
  if to_regclass('public.competitor_urls') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'scrape_jobs_competitor_url_id_fkey'
        and conrelid = 'public.scrape_jobs'::regclass
    ) then
      alter table public.scrape_jobs
        add constraint scrape_jobs_competitor_url_id_fkey
        foreign key (competitor_url_id)
        references public.competitor_urls(id)
        on delete cascade;
    end if;
  else
    raise notice 'public.competitor_urls does not exist yet; run base schema first, then add FK scrape_jobs_competitor_url_id_fkey.';
  end if;
end;
$$;

create or replace function public.set_scrape_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_scrape_jobs_updated_at on public.scrape_jobs;
create trigger set_scrape_jobs_updated_at
before update on public.scrape_jobs
for each row execute procedure public.set_scrape_jobs_updated_at();
