alter table competitor_urls
  add column if not exists mock_next_price numeric(12,2),
  add column if not exists mock_price_enabled boolean not null default false,
  add column if not exists mock_set_at timestamptz;

create index if not exists idx_competitor_urls_mock_price_enabled
  on competitor_urls(mock_price_enabled)
  where mock_price_enabled = true;
