create table if not exists uninstall_feedback (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  shop_domain text,
  email text not null,
  reason_code text not null check (
    reason_code in (
      'too_expensive',
      'missing_features',
      'hard_to_use',
      'not_accurate_enough',
      'technical_issues',
      'switching_tools',
      'temporary_need_only',
      'no_longer_using_shopify',
      'other'
    )
  ),
  details text not null check (char_length(trim(details)) >= 20),
  rating smallint check (rating between 1 and 5),
  submitted_at timestamptz not null default timezone('utc', now())
);

create index if not exists uninstall_feedback_store_id_idx
  on uninstall_feedback(store_id);

create index if not exists uninstall_feedback_user_id_idx
  on uninstall_feedback(user_id);

create index if not exists uninstall_feedback_shop_domain_idx
  on uninstall_feedback(shop_domain);
