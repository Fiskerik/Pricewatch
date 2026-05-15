alter table stores
  add column if not exists shopify_charge_id text;

alter table stores
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_id;
