-- Fix the arming RPC's ambiguous `version` reference.
--
-- `arm_strategy` returns a table column named `version`, which PostgreSQL
-- exposes as a PL/pgSQL variable.  Qualify the strategy_versions column so
-- the authenticated owner workflow can arm a simulated immutable version.
create or replace function public.arm_strategy(
  p_owner uuid,
  p_strategy_id uuid
)
returns table(armed boolean,version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer;
  v_state text;
  v_version uuid;
begin
  select s.current_version,s.state into v_current,v_state
    from public.strategies as s
    where s.id=p_strategy_id and s.owner_user_id=p_owner for update;
  if v_current is null then
    return query select false,null::integer;
    return;
  end if;
  if v_state='armed' then
    return query select true,v_current;
    return;
  end if;
  select sv.id into v_version
    from public.strategy_versions as sv
    where sv.strategy_id=p_strategy_id and sv.version=v_current;
  if v_version is null or not exists (
    select 1 from public.simulations as sim
    where sim.strategy_version_id=v_version
  ) then
    return query select false,v_current;
    return;
  end if;
  update public.strategies
    set state='armed',updated_at=now()
    where id=p_strategy_id and state in ('draft','paused');
  return query select true,v_current;
end
$$;

alter function public.arm_strategy(uuid,uuid) owner to postgres;
revoke all on function public.arm_strategy(uuid,uuid) from public,anon,authenticated;
grant execute on function public.arm_strategy(uuid,uuid) to service_role;
