-- The Worker uses the Supabase service role server-side. RLS remains enabled;
-- these grants allow only the protected Worker to access application tables.
grant usage on schema public to service_role;

grant select, insert, update on public.strategies,
  public.strategy_versions,
  public.simulations,
  public.market_snapshots,
  public.market_events,
  public.decisions,
  public.execution_intents,
  public.engine_status,
  public.account_snapshots
to service_role;

grant usage, select on all sequences in schema public to service_role;
