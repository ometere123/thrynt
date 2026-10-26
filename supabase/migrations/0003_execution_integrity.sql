-- Additive integrity controls for the single Fly executor.
-- This migration does not reset data or change existing rows.

alter table public.engine_status
  add column if not exists lease_generation bigint not null default 0;

alter table public.execution_intents
  add column if not exists engine_instance text,
  add column if not exists lease_generation bigint,
  add column if not exists receipt_status text,
  add column if not exists accepted boolean,
  add column if not exists order_state text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists last_error text;

alter table public.execution_intents
  drop constraint if exists execution_intents_order_state_check;
alter table public.execution_intents
  add constraint execution_intents_order_state_check check (
    order_state is null or order_state in (
      'unknown','accepted','resting','partially_filled','filled',
      'canceled','ioc_no_fill','reverted','rejected'
    )
  );

create index if not exists intents_decision_status_idx
  on public.execution_intents(decision_id,status,updated_at desc);

-- A lease generation changes only when ownership changes or an expired lease is
-- taken. Every reservation and status transition must carry this fence.
create function public.acquire_engine_lease_fenced(p_instance text,p_seconds integer default 40)
returns table(acquired boolean,generation bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_holder text;
  v_until timestamptz;
  v_generation bigint;
  v_next bigint;
begin
  if p_instance is null or char_length(p_instance) not between 1 and 100
    or p_seconds not between 10 and 120 then
    return query select false, null::bigint;
    return;
  end if;

  select lease_holder,lease_until,lease_generation
    into v_holder,v_until,v_generation
    from public.engine_status where singleton=true for update;

  if v_holder is not null and v_holder <> p_instance
    and v_until is not null and v_until >= now() then
    return query select false,v_generation;
    return;
  end if;

  v_next := case
    when v_holder = p_instance and v_until is not null and v_until >= now()
      then v_generation
    else v_generation + 1
  end;
  update public.engine_status
    set lease_holder=p_instance,
        lease_until=now()+make_interval(secs=>p_seconds),
        lease_generation=v_next,
        updated_at=now()
    where singleton=true;
  return query select true,v_next;
end $$;

create function public.reserve_execution_intent_fenced(
  p_idempotency_key text,
  p_decision_id uuid,
  p_pool_address text,
  p_action jsonb,
  p_instance text,
  p_generation bigint
)
returns table(created boolean,id uuid,reason text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_lease public.engine_status%rowtype;
  v_strategy_state text;
  v_id uuid;
begin
  select * into v_lease from public.engine_status where singleton=true for update;
  if v_lease.lease_holder is distinct from p_instance
     or v_lease.lease_generation is distinct from p_generation
     or v_lease.lease_until is null or v_lease.lease_until < now() then
    return query select false,null::uuid,'lease_lost';
    return;
  end if;

  select s.state into v_strategy_state
    from public.decisions d join public.strategies s on s.id=d.strategy_id
    where d.id=p_decision_id;
  if v_strategy_state is null then
    return query select false,null::uuid,'decision_not_found';
    return;
  end if;
  if v_strategy_state <> 'armed' or v_lease.global_pause then
    return query select false,null::uuid,'trading_disabled';
    return;
  end if;

  insert into public.execution_intents(
    idempotency_key,decision_id,pool_address,action,engine_instance,lease_generation
  ) values (
    p_idempotency_key,p_decision_id,p_pool_address,p_action,p_instance,p_generation
  ) on conflict (idempotency_key) do nothing returning execution_intents.id into v_id;

  if v_id is null then
    select e.id into v_id from public.execution_intents e
      where e.idempotency_key=p_idempotency_key;
    return query select false,v_id,'duplicate';
  end if;
  return query select true,v_id,'reserved';
end $$;

create function public.update_execution_intent_fenced(
  p_id uuid,
  p_instance text,
  p_generation bigint,
  p_status text,
  p_tx_hash text default null,
  p_order_id text default null,
  p_result jsonb default '{}'::jsonb,
  p_receipt_status text default null,
  p_accepted boolean default null,
  p_order_state text default null,
  p_last_error text default null
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_lease public.engine_status%rowtype;
  v_current text;
begin
  if p_status not in ('submitting','submitted','confirmed','reverted','unknown','reconciled')
     or (p_receipt_status is not null and p_receipt_status not in ('success','reverted'))
     or (p_order_state is not null and p_order_state not in (
       'unknown','accepted','resting','partially_filled','filled',
       'canceled','ioc_no_fill','reverted','rejected')) then
    return false;
  end if;

  select * into v_lease from public.engine_status where singleton=true for update;
  if v_lease.lease_holder is distinct from p_instance
     or v_lease.lease_generation is distinct from p_generation
     or v_lease.lease_until is null or v_lease.lease_until < now() then
    return false;
  end if;

  select status into v_current from public.execution_intents where id=p_id for update;
  if v_current is null then return false; end if;
  if v_current in ('confirmed','reverted','reconciled')
     and p_status not in (v_current,'reconciled') then
    return false;
  end if;

  update public.execution_intents set
    status=p_status,
    tx_hash=coalesce(p_tx_hash,tx_hash),
    order_id=coalesce(p_order_id,order_id),
    result=coalesce(p_result,'{}'::jsonb),
    receipt_status=coalesce(p_receipt_status,receipt_status),
    accepted=coalesce(p_accepted,accepted),
    order_state=coalesce(p_order_state,order_state),
    last_error=coalesce(p_last_error,last_error),
    reconciled_at=case when p_status='reconciled' then now() else reconciled_at end,
    updated_at=now()
    where id=p_id;
  return true;
end $$;

-- Strategy creation, revision, and arming are kept in one database transaction
-- so the API cannot leave an orphan version or arm a stale version.
create function public.create_strategy_with_version(
  p_owner uuid,p_rule jsonb,p_fingerprint text
)
returns table(strategy_id uuid,version_id uuid,version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_strategy uuid;
  v_version uuid;
begin
  insert into public.strategies(owner_user_id,name,state,current_version)
    values (p_owner,p_rule->>'name','draft',1)
    returning id into v_strategy;
  insert into public.strategy_versions(strategy_id,version,rule,fingerprint)
    values (v_strategy,1,p_rule,p_fingerprint)
    returning id into v_version;
  return query select v_strategy,v_version,1;
end $$;

create function public.create_strategy_version(
  p_owner uuid,p_strategy_id uuid,p_rule jsonb,p_fingerprint text
)
returns table(strategy_id uuid,version_id uuid,version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_current integer;
  v_state text;
  v_version uuid;
  v_next integer;
begin
  select current_version,state into v_current,v_state
    from public.strategies
    where id=p_strategy_id and owner_user_id=p_owner for update;
  if v_current is null or v_state='armed' then return; end if;
  v_next := v_current + 1;
  insert into public.strategy_versions(strategy_id,version,rule,fingerprint)
    values (p_strategy_id,v_next,p_rule,p_fingerprint)
    returning id into v_version;
  update public.strategies set current_version=v_next,state='draft',name=p_rule->>'name',updated_at=now()
    where id=p_strategy_id;
  return query select p_strategy_id,v_version,v_next;
end $$;

create function public.arm_strategy(
  p_owner uuid,p_strategy_id uuid
)
returns table(armed boolean,version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_current integer;
  v_state text;
  v_version uuid;
begin
  select current_version,state into v_current,v_state
    from public.strategies
    where id=p_strategy_id and owner_user_id=p_owner for update;
  if v_current is null then return query select false,null::integer; return; end if;
  if v_state='armed' then return query select true,v_current; return; end if;
  select id into v_version from public.strategy_versions
    where strategy_id=p_strategy_id and version=v_current;
  if v_version is null or not exists (
    select 1 from public.simulations where strategy_version_id=v_version
  ) then
    return query select false,v_current; return;
  end if;
  update public.strategies set state='armed',updated_at=now()
    where id=p_strategy_id and state in ('draft','paused');
  return query select true,v_current;
end $$;

alter function public.acquire_engine_lease_fenced(text,integer) owner to postgres;
alter function public.reserve_execution_intent_fenced(text,uuid,text,jsonb,text,bigint) owner to postgres;
alter function public.update_execution_intent_fenced(uuid,text,bigint,text,text,text,jsonb,text,boolean,text,text) owner to postgres;
alter function public.create_strategy_with_version(uuid,jsonb,text) owner to postgres;
alter function public.create_strategy_version(uuid,uuid,jsonb,text) owner to postgres;
alter function public.arm_strategy(uuid,uuid) owner to postgres;

revoke all on function public.acquire_engine_lease_fenced(text,integer) from public,anon,authenticated;
revoke all on function public.reserve_execution_intent_fenced(text,uuid,text,jsonb,text,bigint) from public,anon,authenticated;
revoke all on function public.update_execution_intent_fenced(uuid,text,bigint,text,text,text,jsonb,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.create_strategy_with_version(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.create_strategy_version(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.arm_strategy(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_engine_lease_fenced(text,integer) to service_role;
grant execute on function public.reserve_execution_intent_fenced(text,uuid,text,jsonb,text,bigint) to service_role;
grant execute on function public.update_execution_intent_fenced(uuid,text,bigint,text,text,text,jsonb,text,boolean,text,text) to service_role;
grant execute on function public.create_strategy_with_version(uuid,jsonb,text) to service_role;
grant execute on function public.create_strategy_version(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.arm_strategy(uuid,uuid) to service_role;
