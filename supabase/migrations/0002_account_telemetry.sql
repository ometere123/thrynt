-- Demonstration account telemetry. Only the service-side API may read/write.
create table public.account_snapshots (
  singleton boolean primary key default true check (singleton),
  observed_at timestamptz not null,
  equity_usd numeric not null,
  available_margin_usd numeric not null,
  locked_margin_usd numeric not null,
  margin_status text not null,
  positions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.account_snapshots enable row level security;
revoke all on public.account_snapshots from anon,authenticated;
