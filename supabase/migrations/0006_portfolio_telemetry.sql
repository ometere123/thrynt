-- Authoritative position/order telemetry is additive. The engine still writes
-- through the service role; end users continue to read through the Worker.
alter table public.account_snapshots
  add column if not exists open_orders jsonb not null default '[]'::jsonb,
  add column if not exists protective_stops jsonb not null default '[]'::jsonb,
  add column if not exists portfolio_status text not null default 'authoritative',
  add column if not exists as_of_block text;

alter table public.account_snapshots enable row level security;
revoke all on public.account_snapshots from anon,authenticated;
