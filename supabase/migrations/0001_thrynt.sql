-- THRYNT single-owner Hideki testnet. Apply to a NEW Supabase project.
create extension if not exists pgcrypto;
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 72),
  state text not null default 'draft' check (state in ('draft','armed','paused','expired')),
  current_version int not null default 1 check (current_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index strategies_owner_idx on public.strategies(owner_user_id,created_at desc);
create table public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id) on delete restrict,
  version int not null check (version > 0),
  rule jsonb not null check (jsonb_typeof(rule) = 'object'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(strategy_id,version)
);
create table public.simulations (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references public.strategy_versions(id) on delete restrict,
  snapshot jsonb not null, result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.market_snapshots (
  symbol text primary key, chain_id int not null default 50383,
  block_number text not null, observed_at timestamptz not null,
  metrics jsonb not null, updated_at timestamptz not null default now()
);
create table public.market_events (
  id text primary key, chain_id int not null default 50383, market text not null,
  kind text not null, block_number text not null, transaction_hash text not null,
  log_index int not null, observed_at timestamptz not null, captured jsonb not null,
  unique(chain_id,transaction_hash,log_index)
);
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id) on delete restrict,
  strategy_version_id uuid not null references public.strategy_versions(id) on delete restrict,
  event_id text not null references public.market_events(id) on delete restrict,
  status text not null check (status in ('unmatched','blocked','observed','reserved','submitted','confirmed','failed','unknown','paused')),
  evaluation jsonb not null, risk jsonb not null,
  recorded_at timestamptz not null default now(),
  unique(strategy_version_id,event_id)
);
create index decisions_time_idx on public.decisions(recorded_at desc);
create table public.execution_intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  decision_id uuid not null unique references public.decisions(id) on delete restrict,
  status text not null default 'reserved'
    check (status in ('reserved','submitting','submitted','confirmed','reverted','unknown','reconciled')),
  pool_address text, order_id text, tx_hash text,
  action jsonb not null, result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intents_status_idx on public.execution_intents(status,created_at desc);
create table public.engine_status (
  singleton boolean primary key default true check (singleton),
  global_pause boolean not null default true,
  lease_holder text, lease_until timestamptz, last_heartbeat timestamptz,
  observed_chain_id int, current_block text, error text,
  updated_at timestamptz not null default now()
);
insert into public.engine_status(singleton) values (true);

create function public.acquire_engine_lease(p_instance text,p_seconds integer default 40)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if p_instance is null or char_length(p_instance) not between 1 and 100
    or p_seconds not between 10 and 120 then return false; end if;
  update public.engine_status
    set lease_holder=p_instance,lease_until=now()+make_interval(secs=>p_seconds),updated_at=now()
    where singleton=true and (lease_until is null or lease_until < now() or lease_holder=p_instance);
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;

create function public.reject_version_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Strategy versions are immutable'; end $$;
create trigger immutable_strategy_versions before update or delete on public.strategy_versions
for each row execute function public.reject_version_mutation();

alter table public.strategies enable row level security;
alter table public.strategy_versions enable row level security;
alter table public.simulations enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.market_events enable row level security;
alter table public.decisions enable row level security;
alter table public.execution_intents enable row level security;
alter table public.engine_status enable row level security;
-- No user-facing direct table permissions. Access is mediated by the Worker.
revoke all on public.strategies,public.strategy_versions,public.simulations,
  public.market_snapshots,public.market_events,public.decisions,
  public.execution_intents,public.engine_status from anon,authenticated;
revoke all on function public.acquire_engine_lease(text,integer) from public,anon,authenticated;
grant execute on function public.acquire_engine_lease(text,integer) to service_role;
revoke all on function public.reject_version_mutation() from public,anon,authenticated;
