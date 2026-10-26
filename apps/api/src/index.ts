import {Hono} from "hono";
import {z} from "zod";
import {evaluate, MetricSnapshotSchema, validateRule} from "@thrynt/core";
import {authorizedUser, db, fingerprint, secureEngineKey, type Env} from "./db.js";

type Variables = {userId: string};
const app = new Hono<{Bindings:Env;Variables:Variables}>();
const uuid = z.string().uuid();
const errorReply = (message:string) => ({error:message});

app.use("*",async (c,next)=>{
  const origin=c.req.header("Origin");
  if (origin && origin === c.env.ALLOWED_ORIGIN) {
    c.header("Access-Control-Allow-Origin",origin);
    c.header("Access-Control-Allow-Headers","Authorization,Content-Type,X-Engine-Key");
    c.header("Access-Control-Allow-Methods","GET,POST,OPTIONS");
    c.header("Vary","Origin");
  }
  c.header("Cache-Control","no-store");
  c.header("X-Content-Type-Options","nosniff");
  if (c.req.method==="OPTIONS") return c.body(null,204);
  await next();
});
app.get("/health",c=>c.json({ok:true,service:"thrynt-api",chainId:50383}));
app.get("/v1/public/overview",async c=>{
  const conn=db(c.env);
  const [engine,markets,decisions,strategies,account]=await Promise.all([
    conn.from("engine_status").select("global_pause,last_heartbeat,current_block").eq("singleton",true).single(),
    conn.from("market_snapshots").select("symbol,block_number,observed_at,metrics").order("symbol"),
    conn.from("decisions").select("id,status,recorded_at").order("recorded_at",{ascending:false}).limit(12),
    conn.from("strategies").select("state"),
    conn.from("account_snapshots").select("*").eq("singleton",true).maybeSingle(),
  ]);
  if (engine.error||markets.error||decisions.error||strategies.error||account.error)
    return c.json(errorReply("Public telemetry unavailable"),503);
  const last=engine.data?.last_heartbeat;
  return c.json({
    engine:{healthy:Boolean(last&&Date.now()-Date.parse(last)<90_000),
      paused:engine.data?.global_pause??true,block:engine.data?.current_block??null},
    markets:markets.data??[],strategyCounts:{armed:(strategies.data??[]).filter(s=>s.state==="armed").length,
      total:strategies.data?.length??0},
    recentDecisions:decisions.data??[],source:"real-testnet-only",
    account:account.data?{
      observedAt:account.data.observed_at,equityUsd:Number(account.data.equity_usd),
      availableMarginUsd:Number(account.data.available_margin_usd),
      lockedMarginUsd:Number(account.data.locked_margin_usd),
      marginStatus:account.data.margin_status,positions:account.data.positions,
    }:null,
  });
});
app.get("/v1/public/traces",async c=>{
  const {data,error}=await db(c.env).from("decisions")
    .select("id,status,recorded_at,evaluation,risk,market_events(market,kind,block_number,transaction_hash),execution_intents(status,tx_hash,order_id,result)")
    .order("recorded_at",{ascending:false}).limit(40);
  if (error) return c.json(errorReply("History unavailable"),503);
  return c.json({traces:data??[],explorer:"https://explorer.testnet.somnia.network/tokyo"});
});

app.use("/v1/owner/*",async(c,next)=>{
  const id=await authorizedUser(c.env,c.req.header("Authorization"));
  if(!id)return c.json(errorReply("Trader authentication required"),401);
  c.set("userId",id);await next();
});
async function owned(env:Env,id:string,owner:string) {
  if(!uuid.safeParse(id).success)return null;
  return (await db(env).from("strategies").select("*")
    .eq("id",id).eq("owner_user_id",owner).maybeSingle()).data;
}
async function latest(env:Env,s:{id:string;current_version:number}) {
  return (await db(env).from("strategy_versions").select("id,rule,fingerprint,version")
    .eq("strategy_id",s.id).eq("version",s.current_version).single()).data;
}
app.get("/v1/owner/strategies",async c=>{
  const {data,error}=await db(c.env).from("strategies")
    .select("*,strategy_versions(id,version,rule,fingerprint,created_at)")
    .eq("owner_user_id",c.get("userId")).order("created_at",{ascending:false});
  if(error)return c.json(errorReply("Unable to load strategies"),503);
  return c.json({strategies:data??[]});
});
app.post("/v1/owner/strategies",async c=>{
  const check=validateRule(await c.req.json().catch(()=>null));
  if(!check.valid||!check.rule)return c.json({errors:check.errors,warnings:check.warnings},422);
  const conn=db(c.env);
  const {data:s,error}=await conn.from("strategies").insert({
    owner_user_id:c.get("userId"),name:check.rule.name,state:"draft",current_version:1,
  }).select("id").single();
  if(error||!s)return c.json(errorReply("Creation failed"),503);
  const {error:ve}=await conn.from("strategy_versions").insert({
    strategy_id:s.id,version:1,rule:check.rule,fingerprint:await fingerprint(check.rule),
  });
  if(ve)return c.json(errorReply("Immutable version insert failed; discard orphan draft"),503);
  return c.json({id:s.id,version:1,warnings:check.warnings},201);
});
app.post("/v1/owner/strategies/:id/version",async c=>{
  const s=await owned(c.env,c.req.param("id"),c.get("userId"));
  if(!s)return c.json(errorReply("Strategy not found"),404);
  if(s.state==="armed")return c.json(errorReply("Pause before revising"),409);
  const check=validateRule(await c.req.json().catch(()=>null));
  if(!check.valid||!check.rule)return c.json({errors:check.errors},422);
  const next=s.current_version+1;
  const conn=db(c.env);
  const {error:ve}=await conn.from("strategy_versions").insert({
    strategy_id:s.id,version:next,rule:check.rule,fingerprint:await fingerprint(check.rule),
  });
  if(ve)return c.json(errorReply("Could not insert new rule version"),503);
  const {data:updated,error}=await conn.from("strategies")
    .update({current_version:next,state:"draft",name:check.rule.name,updated_at:new Date().toISOString()})
    .eq("id",s.id).eq("current_version",s.current_version).neq("state","armed").select("id").maybeSingle();
  if(error||!updated)return c.json(errorReply("Concurrent strategy modification"),409);
  return c.json({id:s.id,version:next,warnings:check.warnings});
});
app.post("/v1/owner/strategies/:id/simulate",async c=>{
  const s=await owned(c.env,c.req.param("id"),c.get("userId"));
  if(!s)return c.json(errorReply("Not found"),404);
  const v=await latest(c.env,s);
  if(!v)return c.json(errorReply("Missing version"),503);
  const parsed=z.object({
    snapshots:z.array(MetricSnapshotSchema).min(1).max(2),
    time:z.string().datetime({offset:true}),
  }).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json(errorReply("Invalid simulation input"),422);
  const check=validateRule(v.rule,new Date(parsed.data.time));
  if(!check.valid||!check.rule)return c.json({errors:check.errors},422);
  const result=evaluate(check.rule,parsed.data.snapshots);
  const {data,error}=await db(c.env).from("simulations").insert({
    strategy_version_id:v.id,snapshot:parsed.data,result,
  }).select("id").single();
  if(error)return c.json(errorReply("Simulation could not be saved"),503);
  return c.json({simulationId:data.id,result,disclaimer:"Preview inputs are illustrative, not independently verified market observations"});
});
app.post("/v1/owner/strategies/:id/arm",async c=>{
  const s=await owned(c.env,c.req.param("id"),c.get("userId"));
  if(!s)return c.json(errorReply("Not found"),404);
  if(s.state==="armed")return c.json({state:"armed"});
  const v=await latest(c.env,s);
  if(!v)return c.json(errorReply("Version unavailable"),503);
  const check=validateRule(v.rule);
  if(!check.valid)return c.json({errors:check.errors},422);
  const conn=db(c.env);
  const {data:sim}=await conn.from("simulations").select("id")
    .eq("strategy_version_id",v.id).order("created_at",{ascending:false}).limit(1);
  if(!sim?.length)return c.json(errorReply("Simulate this rule version before arming"),409);
  const {data:updated,error}=await conn.from("strategies")
    .update({state:"armed",updated_at:new Date().toISOString()})
    .eq("id",s.id).eq("current_version",s.current_version)
    .in("state",["draft","paused"]).select("id").maybeSingle();
  if(error||!updated)return c.json(errorReply("Unable to arm strategy"),409);
  return c.json({state:"armed",version:s.current_version});
});
app.post("/v1/owner/strategies/:id/pause",async c=>{
  const s=await owned(c.env,c.req.param("id"),c.get("userId"));
  if(!s)return c.json(errorReply("Not found"),404);
  const {error}=await db(c.env).from("strategies")
    .update({state:"paused",updated_at:new Date().toISOString()}).eq("id",s.id);
  if(error)return c.json(errorReply("Unable to pause"),503);
  return c.json({state:"paused",warning:"Existing orders and positions remain open"});
});
app.post("/v1/owner/emergency",async c=>{
  const p=z.object({paused:z.boolean()}).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Expected paused boolean"),400);
  const {error}=await db(c.env).from("engine_status")
    .update({global_pause:p.data.paused,updated_at:new Date().toISOString()}).eq("singleton",true);
  if(error)return c.json(errorReply("Emergency state not changed"),503);
  return c.json({globalPause:p.data.paused,warning:"No exchange orders or positions are closed"});
});

app.use("/v1/engine/*",async(c,next)=>{
  if(!await secureEngineKey(c.req.header("X-Engine-Key"),c.env.ENGINE_API_KEY))
    return c.json(errorReply("Unauthorized engine"),401);
  await next();
});
app.post("/v1/engine/lease",async c=>{
  const p=z.object({instance:z.string().min(1).max(100)}).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid instance"),400);
  const {data,error}=await db(c.env).rpc("acquire_engine_lease",{p_instance:p.data.instance,p_seconds:40});
  if(error)return c.json(errorReply("Lease unavailable"),503);
  return c.json({acquired:data===true});
});
app.get("/v1/engine/strategies",async c=>{
  const conn=db(c.env);
  const [s,status]=await Promise.all([
    conn.from("strategies").select("id,state,current_version,strategy_versions(id,version,rule,fingerprint)")
      .eq("state","armed"),
    conn.from("engine_status").select("global_pause,lease_holder,lease_until").eq("singleton",true).single(),
  ]);
  if(s.error||status.error)return c.json(errorReply("Engine state unavailable"),503);
  return c.json({strategies:s.data??[],status:status.data});
});
app.post("/v1/engine/heartbeat",async c=>{
  const p=z.object({instance:z.string().min(1).max(100),block:z.string().regex(/^\d+$/).nullable(),
    error:z.string().max(300).nullable()}).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid heartbeat"),400);
  const {data,error}=await db(c.env).from("engine_status").update({
    last_heartbeat:new Date().toISOString(),observed_chain_id:50383,
    current_block:p.data.block,error:p.data.error,updated_at:new Date().toISOString(),
  }).eq("singleton",true).eq("lease_holder",p.data.instance).select("singleton").maybeSingle();
  if(error||!data)return c.json(errorReply("Lease lost"),409);
  return c.json({ok:true});
});
app.post("/v1/engine/market",async c=>{
  const p=MetricSnapshotSchema.safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Bad market snapshot"),422);
  const {error}=await db(c.env).from("market_snapshots").upsert({
    symbol:p.data.market,block_number:p.data.blockNumber,
    observed_at:p.data.observedAt,metrics:p.data,updated_at:new Date().toISOString(),
  });
  if(error)return c.json(errorReply("Snapshot not stored"),503);
  return c.json({ok:true});
});
app.post("/v1/engine/account",async c=>{
  const schema=z.object({
    observedAt:z.string().datetime({offset:true}),equityUsd:z.number().finite(),
    availableMarginUsd:z.number().finite().nonnegative(),
    lockedMarginUsd:z.number().finite().nonnegative(),
    marginStatus:z.string().max(100),
    positions:z.array(z.object({
      market:z.string().max(15),size:z.string().max(100),
      markUsd:z.number().finite().nonnegative(),notionalUsd:z.number().finite().nonnegative(),
    })).max(50),
  });
  const p=schema.safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid account metrics"),422);
  const {error}=await db(c.env).from("account_snapshots").upsert({
    singleton:true,observed_at:p.data.observedAt,equity_usd:p.data.equityUsd,
    available_margin_usd:p.data.availableMarginUsd,locked_margin_usd:p.data.lockedMarginUsd,
    margin_status:p.data.marginStatus,positions:p.data.positions,updated_at:new Date().toISOString(),
  });
  if(error)return c.json(errorReply("Account state not stored"),503);
  return c.json({ok:true});
});
app.post("/v1/engine/event",async c=>{
  const p=z.object({
    id:z.string().min(20).max(180),market:z.string().max(20),
    kind:z.enum(["FundingUpdated","OpenInterestUpdated","OrderPlaced"]),
    blockNumber:z.string().regex(/^\d+$/),txHash:z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    logIndex:z.number().int().nonnegative(),observedAt:z.string().datetime({offset:true}),
    captured:z.record(z.unknown()),
  }).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid event"),422);
  const x=p.data;
  const {error}=await db(c.env).from("market_events").upsert({
    id:x.id,market:x.market,kind:x.kind,block_number:x.blockNumber,transaction_hash:x.txHash,
    log_index:x.logIndex,observed_at:x.observedAt,captured:x.captured,
  },{onConflict:"id",ignoreDuplicates:true});
  if(error)return c.json(errorReply("Event not stored"),503);
  return c.json({ok:true});
});
app.post("/v1/engine/decision",async c=>{
  const p=z.object({
    strategyId:uuid,versionId:uuid,eventId:z.string().min(20),
    status:z.enum(["unmatched","blocked","observed","reserved","paused"]),
    evaluation:z.record(z.unknown()),risk:z.record(z.unknown()),
  }).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid decision"),422);
  const x=p.data;
  const conn=db(c.env);
  const {data,error}=await conn.from("decisions").upsert({
    strategy_id:x.strategyId,strategy_version_id:x.versionId,event_id:x.eventId,
    status:x.status,evaluation:x.evaluation,risk:x.risk,
  },{onConflict:"strategy_version_id,event_id",ignoreDuplicates:true}).select("id").maybeSingle();
  if(error)return c.json(errorReply("Decision not stored"),503);
  if(data)return c.json({id:data.id,created:true});
  const existing=await conn.from("decisions").select("id").eq("strategy_version_id",x.versionId)
    .eq("event_id",x.eventId).single();
  if(!existing.data)return c.json(errorReply("Decision lookup failed"),503);
  return c.json({id:existing.data.id,created:false});
});
app.post("/v1/engine/intent",async c=>{
  const p=z.object({key:z.string().regex(/^[a-f0-9]{64}$/),decisionId:uuid,
    action:z.record(z.unknown()),poolAddress:z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  }).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid intent"),422);
  const x=p.data;const conn=db(c.env);
  const {data:decision}=await conn.from("decisions").select("strategy_id")
    .eq("id",x.decisionId).single();
  if(!decision)return c.json(errorReply("Decision not found"),404);
  const [strategy,settings]=await Promise.all([
    conn.from("strategies").select("state").eq("id",decision.strategy_id).single(),
    conn.from("engine_status").select("global_pause").eq("singleton",true).single(),
  ]);
  if(strategy.data?.state!=="armed"||settings.data?.global_pause)
    return c.json(errorReply("Trading disabled or strategy paused"),409);
  const {data,error}=await conn.from("execution_intents").insert({
    idempotency_key:x.key,decision_id:x.decisionId,pool_address:x.poolAddress,action:x.action,
  }).select("id").single();
  if(error?.code==="23505")return c.json({created:false,error:"Duplicate intent"},409);
  if(error||!data)return c.json(errorReply("Intent reservation failed"),503);
  return c.json({created:true,id:data.id},201);
});
app.post("/v1/engine/intent/:id/status",async c=>{
  const id=c.req.param("id");
  if(!uuid.safeParse(id).success)return c.json(errorReply("Invalid intent ID"),400);
  const p=z.object({
    status:z.enum(["submitting","submitted","confirmed","reverted","unknown","reconciled"]),
    txHash:z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    orderId:z.string().regex(/^\d+$/).optional(),
    result:z.record(z.unknown()).default({}),
  }).safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return c.json(errorReply("Invalid status"),422);
  const x=p.data;
  const {error}=await db(c.env).from("execution_intents").update({
    status:x.status,...(x.txHash?{tx_hash:x.txHash}:{}),
    ...(x.orderId?{order_id:x.orderId}:{}),result:x.result,updated_at:new Date().toISOString(),
  }).eq("id",id);
  if(error)return c.json(errorReply("Intent update failed"),503);
  return c.json({ok:true});
});
app.get("/v1/engine/activity/:id",async c=>{
  const id=c.req.param("id");
  if(!uuid.safeParse(id).success)return c.json(errorReply("Bad strategy id"),400);
  const now=new Date();
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString();
  const {data,error}=await db(c.env).from("execution_intents")
    .select("created_at,decisions!inner(strategy_id)")
    .eq("decisions.strategy_id",id).gte("created_at",start)
    .order("created_at",{ascending:false}).limit(21);
  if(error)return c.json(errorReply("Activity lookup failed"),503);
  return c.json({actionsToday:data?.length??0,lastActionAt:data?.[0]?.created_at??null});
});
app.get("/v1/engine/unresolved",async c=>{
  const {data,error}=await db(c.env).from("execution_intents")
    .select("id,status,tx_hash,created_at").in("status",["reserved","submitting","submitted","unknown"])
    .order("created_at",{ascending:true}).limit(30);
  if(error)return c.json(errorReply("Unable to reconcile pending intents"),503);
  return c.json({intents:data??[]});
});
app.post("/v1/engine/pause/:id",async c=>{
  const id=c.req.param("id");
  if(!uuid.safeParse(id).success)return c.json(errorReply("Invalid strategy"),400);
  const {data,error}=await db(c.env).from("strategies")
    .update({state:"paused",updated_at:new Date().toISOString()})
    .eq("id",id).eq("state","armed").select("id").maybeSingle();
  if(error||!data)return c.json(errorReply("Strategy no longer armed"),409);
  return c.json({state:"paused"});
});
app.onError((error,c)=>{
  console.error("api error",error.message.slice(0,240));
  return c.json(errorReply("Internal request failure"),503);
});
export default app;
