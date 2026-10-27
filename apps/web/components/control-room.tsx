"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {
  Activity,ArrowDownRight,ArrowRight,ArrowUpRight,Ban,BarChart3,
  Bell,Bot,Check,CheckCircle2,ChevronDown,ChevronRight,CircleAlert,
  CircleDot,Clock3,Command,Database,ExternalLink,Eye,GitBranch,Globe2,
  HeartPulse,History,KeyRound,Layers3,LockKeyhole,Menu,Pause,Play,
  Plus,Radio,RefreshCcw,Save,Settings2,ShieldCheck,SlidersHorizontal,
  Sparkles,Terminal,Trash2,Wallet2,X,Zap,
} from "lucide-react";
import {
  MARKET_CODES,METRIC_CODES,compareNumbers,evaluate,templates,validateRule,
  type Market,type Metric,type MetricSnapshot,type Rule,
} from "@thrynt/core";
import {ApiRequestError,authClient,ownerGet,ownerPost,publicGet} from "../lib/client";

type Tab="Overview"|"Strategy Studio"|"Markets"|"Live Pulse"|"Positions & Risk"|"Decision Trace"|"Settings";
const tabs:Tab[]=["Overview","Strategy Studio","Markets","Live Pulse","Positions & Risk","Decision Trace","Settings"];
const icons=[Layers3,SlidersHorizontal,BarChart3,Radio,ShieldCheck,History,Settings2];
type Overview={
  engine:{healthy:boolean;paused:boolean;block:string|null};
  markets:{symbol:Market;block_number:string;observed_at:string;metrics:MetricSnapshot}[];
  strategyCounts:{armed:number;total:number};
  recentDecisions:{id:string;status:string;recorded_at:string}[];
  account?:AccountState|null;
};
type Trace={
  id:string;status:string;recorded_at:string;
  evaluation:{matched?:boolean;conditions?:{metric:string;actual?:number;threshold:number;matched:boolean}[]};
  risk:{blockedBy?:string[];message?:string;details?:string};
  market_events?:{market:string;kind:string;block_number:string;transaction_hash:string}|null;
  execution_intents?:{status:string;tx_hash:string|null;order_id:string|null;result:Record<string,unknown>;
    receipt_status:string|null;accepted:boolean|null;order_state:string|null;reconciled_at:string|null}[]|null;
};
type AccountState={
  observedAt:string;equityUsd:number;availableMarginUsd:number;lockedMarginUsd:number;
  marginStatus:string;positions:{market:string;size:string;markUsd:number;notionalUsd:number}[];
};
type StrategyRow={
  id:string;name:string;state:string;current_version:number;
  strategy_versions:{id:string;version:number;rule:Rule}[];
};
const short=(s:string|null|undefined,n=11)=>s?s.length>n+6?`${s.slice(0,n)}…${s.slice(-5)}`:s:"—";
const fmt=(n:number|undefined,digits=2)=>n===undefined?"—":new Intl.NumberFormat("en-US",{
  minimumFractionDigits:digits,maximumFractionDigits:digits,
}).format(n);
const ago=(iso:string|null|undefined)=>{
  if(!iso)return "No observations";
  const sec=Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000));
  if(sec<60)return `${sec}s ago`;
  if(sec<3600)return `${Math.floor(sec/60)}m ago`;
  return `${Math.floor(sec/3600)}h ago`;
};
function Pill({children,tone="neutral"}:{children:React.ReactNode;tone?:"green"|"amber"|"red"|"neutral"|"blue"}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
function Panel({title,subtitle,right,children,className=""}:{
  title:string;subtitle?:string;right?:React.ReactNode;children:React.ReactNode;className?:string;
}) {
  return <section className={`panel ${className}`}>
    <div className="panel-top"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{right}</div>
    {children}
  </section>;
}
function Empty({icon:Icon=Activity,title,description}:{
  icon?:typeof Activity;title:string;description:string;
}) {
  return <div className="empty"><Icon size={27}/><strong>{title}</strong><span>{description}</span></div>;
}
const metricLabels:Record<Metric,string>={
  markUsd:"Mark price (USD)",indexUsd:"Index price (USD)",
  premiumBps:"Mark premium (bps)",fundingBps8h:"Funding / 8h (bps)",
  openInterestUsd:"Open interest (USD)",availableMarginUsd:"Available margin (USD)",
  marginRatioBps:"Margin health (bps)",
};
// UX defaults are minimum-sized starting points from the currently deployed
// Hideki market grids. The engine always re-reads authoritative SDK metadata
// and rejects a stale or invalid quantity before any signed order.
const defaultTradeQuantities:Record<Market,string>={
  BTC:"0.00013",ETH:"0.004",SOL:"0.1",XRP:"6.9",DOGE:"120",
};
const cmpLabels={gt:">",gte:"≥",lt:"<",lte:"≤",eq:"="};
const utcDateTimeInput=(iso:string)=>{
  const date=new Date(iso);
  return Number.isFinite(date.getTime())?date.toISOString().slice(0,16):"";
};
const parseUtcDateTimeInput=(value:string)=>{
  const timestamp=Date.parse(`${value}:00.000Z`);
  return Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
};
const simulated=(market:Market):MetricSnapshot=>({
  market,observedAt:new Date().toISOString(),blockNumber:"0",
  markUsd:market==="BTC"?110000:market==="ETH"?4000:180,
  indexUsd:market==="BTC"?109900:market==="ETH"?3990:179,
  premiumBps:25,fundingBps8h:4,openInterestUsd:50000,
  availableMarginUsd:120,marginRatioBps:26000,
});

export function ControlRoom() {
  const [tab,setTab]=useState<Tab>("Overview");
  const [mobile,setMobile]=useState(false);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [traces,setTraces]=useState<Trace[]>([]);
  const [fetchError,setFetchError]=useState<string|null>(null);
  const [authUserId,setAuthUserId]=useState<string|null>(null);
  const [authRevision,setAuthRevision]=useState(0);
  const [trader,setTrader]=useState<string|null>(null);
  const [ownerAuthorized,setOwnerAuthorized]=useState(false);
  const [email,setEmail]=useState("");
  const [authMessage,setAuthMessage]=useState("");
  const [strategies,setStrategies]=useState<StrategyRow[]>([]);
  const [draft,setDraft]=useState<Rule|null>(null);
  const [savedId,setSavedId]=useState<string|null>(null);
  const [dirty,setDirty]=useState(false);
  const [simulation,setSimulation]=useState<{matched:boolean;source:string;conditions:number}|null>(null);
  const [simulationStored,setSimulationStored]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{message:string;error:boolean}|null>(null);
  const authUserIdRef=useRef<string|null>(null);
  const ownerRequestRef=useRef(0);

  const report=useMemo(()=>draft?validateRule(draft):null,[draft]);
  const update=(change:(current:Rule)=>Rule)=>{
    setDraft(current=>current?change(structuredClone(current)):current);
    setDirty(true);setSimulationStored(false);setSimulation(null);
  };
  const toast=(message:string,error=false)=>{
    setNotice({message,error});setTimeout(()=>setNotice(null),7000);
  };
  const loadPublic=useCallback(async()=>{
    try {
      const [o,t]=await Promise.all([
        publicGet<Overview>("/v1/public/overview"),
        publicGet<{traces:Trace[]}>("/v1/public/traces"),
      ]);
      setOverview(o);setTraces(t.traces??[]);setFetchError(null);
    }catch(err){setFetchError(err instanceof Error?err.message:"Network unavailable");}
  },[]);
  const loadOwner=useCallback(async()=>{
    const request=++ownerRequestRef.current;
    try {
      const data=await ownerGet<{strategies:StrategyRow[]}>("/v1/owner/strategies");
      if(request!==ownerRequestRef.current)return;
      setStrategies(data.strategies??[]);setOwnerAuthorized(true);
    }catch(err){
      if(request!==ownerRequestRef.current)return;
      setStrategies([]);setOwnerAuthorized(false);
      if(!(err instanceof ApiRequestError&&err.status===401))
        toast(err instanceof Error?err.message:"Unable to load your strategies",true);
    }
  },[]);

  useEffect(()=>{
    setDraft(templates()[0]!);
    void loadPublic();
    const interval=setInterval(()=>void loadPublic(),15000);
    const auth=authClient();
    if(!auth)return()=>clearInterval(interval);
    let disposed=false;
    const applyUser=(user:{id:string;email?:string|null}|null)=>{
      if(disposed)return;
      const previous=authUserIdRef.current;
      authUserIdRef.current=user?.id??null;
      ownerRequestRef.current++;
      setAuthUserId(user?.id??null);
      setTrader(user?.email??null);
      setAuthRevision(current=>current+1);
      if(!user|| (previous!==null&&previous!==user.id)){
        setOwnerAuthorized(false);setStrategies([]);setSavedId(null);
      }
    };
    void auth.auth.getUser().then(({data})=>{
      applyUser(data.user);
    });
    const {data:listener}=auth.auth.onAuthStateChange((_event,session)=>{
      applyUser(session?.user??null);
    });
    return()=>{disposed=true;ownerRequestRef.current++;clearInterval(interval);listener.subscription.unsubscribe();};
  },[loadPublic]);
  useEffect(()=>{
    if(authUserId)void loadOwner();
    else {setStrategies([]);setOwnerAuthorized(false);}
  },[authUserId,authRevision,loadOwner]);
  const latestMarkets=overview?.markets??[];
  const market=(code:Market)=>latestMarkets.find(m=>m.symbol===code);
  const status=overview?.engine;
  const live=status?.healthy&&!status.paused;

  const useTemplate=(index:number)=>{
    setDraft(templates()[index]!);
    setSavedId(null);setDirty(true);setSimulationStored(false);setSimulation(null);
    toast("Template loaded into Strategy Studio");
    setTab("Strategy Studio");
  };
  const saveDraft=async()=>{
    if(!draft||!report?.valid)return;
    setBusy(true);
    try {
      if(savedId){
        const result=await ownerPost<{version:number}>(`/v1/owner/strategies/${savedId}/version`,draft);
        toast(`Rule version ${result.version} saved. Run simulation before arming.`);
      }else{
        const result=await ownerPost<{id:string}>("/v1/owner/strategies",draft);
        setSavedId(result.id);toast("Immutable strategy draft saved in Supabase");
      }
      setDirty(false);setSimulationStored(false);await loadOwner();
    }catch(err){if(err instanceof ApiRequestError&&err.status===401){setOwnerAuthorized(false);setStrategies([]);}toast(err instanceof Error?err.message:"Save failed",true);}
    finally{setBusy(false);}
  };
  const simulate=async()=>{
    if(!draft||!report?.valid)return;
    const marketCodes=[...new Set([
      draft.trigger.market,...draft.groups.flatMap(g=>g.conditions.map(c=>c.market)),
      ...("market" in draft.action?[draft.action.market]:[]),
    ])];
    const allLive=marketCodes.every(code=>{
      const row=market(code);
      return row&&Date.now()-Date.parse(row.observed_at)<60000;
    });
    const snapshots=marketCodes.map(code=>
      allLive?market(code)!.metrics:simulated(code));
    const result=evaluate(draft,snapshots);
    setSimulation({matched:result.matched,source:allLive?"Recent published testnet snapshots":"Illustrative test data",
      conditions:result.conditions.filter(c=>c.matched).length});
    setSimulationStored(false);
    if(savedId&&!dirty){
      setBusy(true);
      try{
        await ownerPost(`/v1/owner/strategies/${savedId}/simulate`,{
          snapshots,time:new Date().toISOString(),
        });
        setSimulationStored(true);
        toast("Simulation stored against the current immutable rule version");
      }catch(err){if(err instanceof ApiRequestError&&err.status===401){setOwnerAuthorized(false);setStrategies([]);}toast(err instanceof Error?err.message:"Simulation not saved",true);}
      finally{setBusy(false);}
    }else toast("Local preview complete; save the rule before an armable simulation");
  };
  const arm=async()=>{
    if(!savedId||dirty||!simulationStored)return;
    setBusy(true);
    try{
      await ownerPost(`/v1/owner/strategies/${savedId}/arm`);
      toast("Strategy armed. Live trades still require healthy engine, global enable and Fly testnet opt-in.");
      await loadOwner();
    }catch(err){if(err instanceof ApiRequestError&&err.status===401){setOwnerAuthorized(false);setStrategies([]);}toast(err instanceof Error?err.message:"Arm rejected",true);}
    finally{setBusy(false);}
  };
  const pauseStrategy=async(id:string)=>{
    setBusy(true);
    try{await ownerPost(`/v1/owner/strategies/${id}/pause`);toast("Strategy paused; resting orders and positions remain");await loadOwner();}
    catch(err){if(err instanceof ApiRequestError&&err.status===401){setOwnerAuthorized(false);setStrategies([]);}toast(err instanceof Error?err.message:"Unable to pause",true);}
    finally{setBusy(false);}
  };
  const emergency=async(paused:boolean)=>{
    setBusy(true);
    try{
      await ownerPost("/v1/owner/emergency",{paused});
      toast(paused?"Global new entries paused":"Global evaluation allowed (Fly live execution has its own independent opt-in)");
      await loadPublic();
    }catch(err){if(err instanceof ApiRequestError&&err.status===401){setOwnerAuthorized(false);setStrategies([]);}toast(err instanceof Error?err.message:"Global control rejected",true);}
    finally{setBusy(false);}
  };
  const sendMagicLink=async()=>{
    const auth=authClient();
    if(!auth){setAuthMessage("Supabase Auth is not configured");return;}
    setBusy(true);
    const {error}=await auth.auth.signInWithOtp({email,
      options:{emailRedirectTo:typeof window==="undefined"?undefined:window.location.origin}});
    setAuthMessage(error?error.message:"Check your email for the login link. Only the approved account can manage strategies.");
    setBusy(false);
  };
  const logout=async()=>{
    ownerRequestRef.current++;
    await authClient()?.auth.signOut();
    authUserIdRef.current=null;
    setAuthUserId(null);setTrader(null);setOwnerAuthorized(false);setSavedId(null);
  };

  return <div className="shell">
    <aside className={`sidebar ${mobile?"sidebar-mobile":""}`}>
      <div className="logo">
        <span className="logo-glyph"><Zap size={22} strokeWidth={3}/></span>
        <div><strong>THRYNT</strong><span>EXECUTION INTELLIGENCE</span></div>
        <button className="mobile-close icon-button" onClick={()=>setMobile(false)} aria-label="Close navigation"><X size={18}/></button>
      </div>
      <div className="sidebar-divider"/>
      <div className="nav-label">WORKSPACE</div>
      <nav>{tabs.map((item,index)=>{
        const Icon=icons[index]!;
        return <button key={item} className={`nav-item ${tab===item?"selected":""}`}
          onClick={()=>{setTab(item);setMobile(false);}}>
          <Icon size={18}/><span>{item}</span>{tab===item&&<span className="nav-indicator"/>}
        </button>;
      })}</nav>
      <div className="sidebar-bottom">
        <div className="network-tile"><span className="network-dot"/>
          <div><strong>SOMNIA HIDEKI</strong><span>Chain ID · 50383</span></div><Globe2 size={16}/>
        </div>
        <div className="sidebar-credit">DREAMDEX / SOMNIA<br/>PERPS BUILDER BOUNTY</div>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <button className="mobile-open icon-button" onClick={()=>setMobile(true)} aria-label="Open navigation"><Menu size={20}/></button>
        <div className="crumb">WORKSPACE <ChevronRight size={13}/> <span>{tab.toUpperCase()}</span></div>
        <div className="top-actions">
          <Pill tone={live?"green":status?.healthy?"amber":"red"}>
            <CircleDot size={11}/>{live?"ENGINE READY":status?.healthy?"GLOBAL PAUSE":"ENGINE OFFLINE"}
          </Pill>
          <span className="header-block">BLOCK <strong>{status?.block??"—"}</strong></span>
          <button className="icon-button" title="Refresh" onClick={()=>void loadPublic()}><RefreshCcw size={17}/></button>
          <button className="account-chip" onClick={()=>setTab("Settings")}>
            <span className="avatar">{trader?trader.slice(0,1).toUpperCase():"G"}</span>
            {trader?"TRADER":"GUEST"}
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page-heading">
          <div className="eyebrow"><span/> EVENT-DRIVEN PERPS AUTOMATION</div>
          <h1>{tab}</h1>
          <p>{tab==="Overview"?"Set the condition. Prove the execution.":
            tab==="Strategy Studio"?"Compose deterministic strategies. Run the checks. Then arm deliberately.":
            tab==="Decision Trace"?"Every trigger, every rejection, every onchain outcome.":
            tab==="Settings"?"Authentication, linked-bot setup and hard execution controls.":
            tab==="Markets"?"Live DreamDEX perpetual market snapshots, read from Somnia.":
            tab==="Live Pulse"?"Watch the event-to-decision lifecycle as it arrives.":
            "Know the account state before letting a strategy act."}</p>
        </div>
        {fetchError&&<div className="banner-warning"><CircleAlert size={17}/>
          Live data unavailable: {fetchError}. Values below are not fabricated.
        </div>}
        {tab==="Overview"&&<>
          <div className="metrics-grid">
            <MetricCard label="ARMED STRATEGIES" value={String(overview?.strategyCounts.armed??"—")} icon={GitBranch} note="Active configured rules" />
            <MetricCard label="ALL STRATEGIES" value={String(overview?.strategyCounts.total??"—")} icon={Layers3} note="Saved to Supabase"/>
            <MetricCard label="DECISION RECORDS" value={String(overview?.recentDecisions.length??"—")} icon={Activity} note="Last 12 received"/>
            <MetricCard label="ENGINE CONNECTION" value={status?.healthy?"HEALTHY":"OFFLINE"} icon={HeartPulse} note={status?.paused?"Global pause active":"Live strategy observer"}/>
          </div>
          <div className="two-column wide-left">
            <Panel title="Execution control room" subtitle="One accountable strategy path from signal to transaction"
              right={<Pill tone="blue"><Zap size={11}/> HIDEKI TESTNET</Pill>}>
              <div className="process-grid">{[
                ["01","OBSERVE","Somnia pool event","green"],
                ["02","EVALUATE","Versioned rule","blue"],
                ["03","GUARD","Margin + permission","amber"],
                ["04","EXECUTE","Linked bot order","blue"],
                ["05","RECONCILE","Receipt + fill","green"],
              ].map(([num,name,desc,tone])=>
                <div key={num} className="process-step"><span className={`step-dot ${tone}`}>{num}</span>
                  <strong>{name}</strong><small>{desc}</small></div>)}</div>
              <div className="overview-story"><div className="story-icon"><ShieldCheck size={22}/></div>
                <div><strong>Decision Trace is the product.</strong>
                  <p>THRYNT records the rule version, observed market inputs, mandatory safety result, signed action and independently checkable chain outcome. Blocked trades get a reason too.</p></div>
              </div>
              <button className="button button-primary" onClick={()=>setTab("Strategy Studio")}>
                <Plus size={17}/> Create a strategy <ArrowRight size={15}/>
              </button>
            </Panel>
            <Panel title="Engine status" subtitle="Independent Fly.io worker">
              <div className="status-list">
                <StatusLine label="Web frontend" value="Vercel" tone="green"/>
                <StatusLine label="Control API" value={fetchError?"Unreachable":"Cloudflare Worker"} tone={fetchError?"red":"green"}/>
                <StatusLine label="Database" value={fetchError?"Unknown":"Supabase"} tone={fetchError?"amber":"green"}/>
                <StatusLine label="Event listener" value={status?.healthy?"Connected":"Not confirmed"} tone={status?.healthy?"green":"amber"}/>
                <StatusLine label="Trading" value={status?.paused?"Paused":"Rule-gated"} tone={status?.paused?"amber":"green"}/>
              </div>
              <div className="caption-callout"><LockKeyhole size={15}/>
                The frontend never holds or uses the bot private key.</div>
            </Panel>
          </div>
          <div className="two-column">
            <Panel title="Latest market observations" subtitle="Recorded by the engine; never sample placeholders"
              right={<button className="text-button" onClick={()=>setTab("Markets")}>All markets <ArrowRight size={13}/></button>}>
              {latestMarkets.length?latestMarkets.slice(0,4).map(m=>
                <div className="market-row" key={m.symbol}>
                  <span className="coin-icon">{m.symbol.slice(0,1)}</span>
                  <div className="market-name"><strong>{m.symbol}-PERP</strong><span>{ago(m.observed_at)}</span></div>
                  <div className="align-right"><strong>${fmt(m.metrics.markUsd)}</strong>
                    <span>Funding {fmt(m.metrics.fundingBps8h,2)} bps / 8h</span></div>
                </div>):<Empty title="Waiting for market snapshots"
                description="The Fly engine will publish real pricing and funding measurements here." icon={BarChart3}/>}
            </Panel>
            <Panel title="Recent decisions" subtitle="Read-only evidence feed"
              right={<button className="text-button" onClick={()=>setTab("Decision Trace")}>View traces <ArrowRight size={13}/></button>}>
              {overview?.recentDecisions.length?overview.recentDecisions.slice(0,5).map(d=>
                <div className="decision-row" key={d.id}><span className="decision-icon"><Activity size={14}/></span>
                  <div><strong>{d.status.toUpperCase()}</strong><span>{short(d.id,8)}</span></div>
                  <time>{ago(d.recorded_at)}</time></div>):
                <Empty title="No decisions yet" description="Once a supported live event is evaluated, it will be recorded here." icon={History}/>}
            </Panel>
          </div>
        </>}
        {tab==="Strategy Studio"&&draft&&<>
          <div className="studio-grid">
            <div className="studio-main">
              <Panel title="Start from a strategy" subtitle="Three configurations, one shared deterministic evaluator">
                <div className="templates">{templates().map((t,i)=><button key={t.name}
                  onClick={()=>useTemplate(i)} className={`template ${draft.name===t.name?"active":""}`}>
                  {i===0?<GitBranch size={19}/>:i===1?<TrendingGlyph/>:<ShieldCheck size={19}/>}
                  <strong>{t.name}</strong><span>{i===0?"Cross-market entry":i===1?"Funding alert":"Account safety"}</span>
                  <ChevronRight size={16}/></button>)}</div>
              </Panel>
              <Panel title="01 / Identity & trigger" subtitle="Choose the event that starts evaluation"
                right={<Pill tone="blue">REACTIVITY</Pill>}>
                <label className="field"><span>Strategy name</span><input value={draft.name}
                  onChange={e=>update(r=>({...r,name:e.target.value}))} maxLength={72}/></label>
                <label className="field"><span>Description</span><textarea rows={2} value={draft.description}
                  onChange={e=>update(r=>({...r,description:e.target.value}))}/></label>
                <div className="field-grid">
                  <label className="field"><span>Trigger market</span>
                    <select value={draft.trigger.market} onChange={e=>update(r=>({...r,trigger:{...r.trigger,market:e.target.value as Market}}))}>
                      {MARKET_CODES.map(m=><option key={m}>{m}</option>)}</select></label>
                  <label className="field"><span>Onchain event</span>
                    <select value={draft.trigger.event} onChange={e=>update(r=>({...r,trigger:{...r.trigger,event:e.target.value as Rule["trigger"]["event"]}}))}>
                      <option>FundingUpdated</option><option>OpenInterestUpdated</option><option>OrderPlaced</option>
                    </select></label>
                </div>
                <div className="help"><Radio size={14}/> Only confirmed, supported Hideki pool events should be armed for live use.</div>
              </Panel>
              <Panel title="02 / Market conditions" subtitle="Compose up to two AND/OR groups; market safety checks always remain mandatory"
                right={<Pill tone="neutral">MAX 2 MARKETS</Pill>}>
                {draft.groups.map((g,gi)=><div className="rule-group" key={g.id}>
                  <div className="group-heading"><span className="group-number">GROUP {gi+1}</span>
                    <div className="segmented">{(["ALL","ANY"] as const).map(op=>
                      <button key={op} onClick={()=>update(r=>{r.groups[gi]!.operator=op;return r;})}
                        className={g.operator===op?"on":""}>{op==="ALL"?"AND":"OR"}</button>)}</div>
                    {draft.groups.length>1&&<button className="icon-button danger" title="Remove group"
                      onClick={()=>update(r=>{r.groups.splice(gi,1);return r;})}><Trash2 size={15}/></button>}</div>
                  {g.conditions.map((c,ci)=><div className="condition-row" key={c.id}>
                    <select aria-label="Condition market" value={c.market}
                      onChange={e=>update(r=>{r.groups[gi]!.conditions[ci]!.market=e.target.value as Market;return r;})}>
                      {MARKET_CODES.map(m=><option key={m}>{m}</option>)}</select>
                    <select aria-label="Condition metric" className="condition-metric" value={c.metric}
                      onChange={e=>update(r=>{r.groups[gi]!.conditions[ci]!.metric=e.target.value as Metric;return r;})}>
                      {METRIC_CODES.map(m=><option key={m} value={m}>{metricLabels[m]}</option>)}</select>
                    <select aria-label="Comparator" value={c.compare}
                      onChange={e=>update(r=>{r.groups[gi]!.conditions[ci]!.compare=e.target.value as typeof c.compare;return r;})}>
                      {Object.entries(cmpLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
                    <input aria-label="Threshold" type="number" step="any" value={c.value}
                      onChange={e=>update(r=>{r.groups[gi]!.conditions[ci]!.value=Number(e.target.value);return r;})}/>
                    <button className="icon-button danger" aria-label="Remove condition" disabled={g.conditions.length===1}
                      onClick={()=>update(r=>{r.groups[gi]!.conditions.splice(ci,1);return r;})}><X size={15}/></button>
                  </div>)}
                  {g.conditions.length<3&&<button className="add-link" onClick={()=>update(r=>{
                    r.groups[gi]!.conditions.push({id:`rule-${crypto.randomUUID().slice(0,8)}`,market:r.trigger.market,
                      metric:"markUsd",compare:"gt",value:1000});return r;})}>
                    <Plus size={14}/> Add condition</button>}
                </div>)}
                {draft.groups.length<2&&<div className="group-add">
                  <span>COMBINE GROUPS WITH</span><div className="segmented">{(["ALL","ANY"] as const).map(op=>
                    <button key={op} onClick={()=>update(r=>({...r,groupsOperator:op}))}
                      className={draft.groupsOperator===op?"on":""}>{op==="ALL"?"AND":"OR"}</button>)}</div>
                  <button className="add-link" onClick={()=>update(r=>{
                    r.groups.push({id:`g-${crypto.randomUUID().slice(0,8)}`,operator:"ALL",
                      conditions:[{id:`c-${crypto.randomUUID().slice(0,8)}`,
                        market:r.trigger.market,metric:"fundingBps8h",compare:"gt",value:1}]});return r;})}>
                    <Plus size={14}/> Add second group</button></div>}
              </Panel>
              <Panel title="03 / Authorized action" subtitle="Exactly one bounded action per trigger">
                <div className="action-options">{(["trade","reduce","notify","pause"] as const).map(kind=>
                  <button className={`action-choice ${draft.action.kind===kind?"chosen":""}`} key={kind}
                    onClick={()=>update(r=>({...r,action:kind==="trade"?
                      {kind,market:r.trigger.market,side:"long",quantity:defaultTradeQuantities[r.trigger.market],orderType:"IOC",slippageBps:15}:
                      kind==="reduce"?{kind,market:r.trigger.market,percent:50,slippageBps:15}:
                      kind==="notify"?{kind,message:"THRYNT strategy condition matched"}:{kind}}))}>
                    {kind==="trade"?<ArrowUpRight size={19}/>:kind==="reduce"?<ArrowDownRight size={19}/>:
                      kind==="notify"?<Bell size={19}/>:<Pause size={19}/>}
                    <strong>{kind==="trade"?"Place order":kind==="reduce"?"Reduce position":kind==="notify"?"Notify":"Pause"}</strong>
                  </button>)}</div>
                {draft.action.kind==="trade"&&<div className="field-grid">
                  <label className="field"><span>Trade market</span><select value={draft.action.market}
                    onChange={e=>update(r=>{if(r.action.kind==="trade")r.action.market=e.target.value as Market;return r;})}>
                    {MARKET_CODES.map(m=><option key={m}>{m}</option>)}</select></label>
                  <label className="field"><span>Side</span><select value={draft.action.side}
                    onChange={e=>update(r=>{if(r.action.kind==="trade")r.action.side=e.target.value as "long"|"short";return r;})}>
                    <option value="long">Long / buy</option><option value="short">Short / sell</option></select></label>
                  <label className="field"><span>Base quantity</span><input value={draft.action.quantity}
                    onChange={e=>update(r=>{if(r.action.kind==="trade")r.action.quantity=e.target.value;return r;})}/></label>
                  <label className="field"><span>Order policy</span><select value={draft.action.orderType}
                    onChange={e=>update(r=>{if(r.action.kind==="trade"){r.action.orderType=e.target.value as "IOC"|"POST_ONLY";if(r.action.orderType==="POST_ONLY")r.action.slippageBps=0;}return r;})}>
                    <option value="IOC">IOC — bounded taker limit</option><option value="POST_ONLY">Post-only — rests on book</option></select></label>
                  <label className="field"><span>Slippage budget (bps)</span><input type="number" min={0} max={50}
                    value={draft.action.slippageBps} onChange={e=>update(r=>{if(r.action.kind==="trade")r.action.slippageBps=Number(e.target.value);return r;})}/></label>
                </div>}
                {draft.action.kind==="reduce"&&<div className="field-grid">
                  <label className="field"><span>Market</span><select value={draft.action.market}
                    onChange={e=>update(r=>{if(r.action.kind==="reduce")r.action.market=e.target.value as Market;return r;})}>
                    {MARKET_CODES.map(m=><option key={m}>{m}</option>)}</select></label>
                  <label className="field"><span>Position reduction (%)</span><input type="number" min={1} max={100}
                    value={draft.action.percent} onChange={e=>update(r=>{if(r.action.kind==="reduce")r.action.percent=Number(e.target.value);return r;})}/></label>
                  <label className="field"><span>Slippage budget (bps)</span><input type="number" min={0} max={50}
                    value={draft.action.slippageBps} onChange={e=>update(r=>{if(r.action.kind==="reduce")r.action.slippageBps=Number(e.target.value);return r;})}/></label>
                </div>}
                {draft.action.kind==="reduce"&&<div className="banner-warning">
                  <CircleAlert size={16}/> Reduce-only linked-bot trading is observe-only pending live venue verification; this rule will not sign a reduction yet.
                </div>}
                {draft.action.kind==="notify"&&<label className="field"><span>Evidence message</span>
                  <input value={draft.action.message} onChange={e=>update(r=>{if(r.action.kind==="notify")r.action.message=e.target.value;return r;})}/></label>}
                <div className="help"><ShieldCheck size={14}/> The action is never permitted to bypass account-wide safety limits.</div>
              </Panel>
              <Panel title="04 / Mandatory safety limits" subtitle="Users may tighten risk caps, never disable the engine's hard gates"
                right={<Pill tone="green"><ShieldCheck size={12}/> ALWAYS ENFORCED</Pill>}>
                <div className="field-grid">
                  {([
                    ["maxNotionalUsd","Max action notional (USD)"],
                    ["maxTotalExposureUsd","Max total exposure (USD)"],
                    ["minAvailableMarginUsd","Min free margin (USD)"],
                    ["maxDailyActions","Max actions / UTC day"],
                    ["cooldownSeconds","Cooldown (seconds)"],
                    ["maxDataAgeSeconds","Max observed data age (sec)"],
                  ] as const).map(([key,label])=><label className="field" key={key}><span>{label}</span>
                    <input type="number" min={0} value={draft.limits[key]} onChange={e=>update(r=>{
                      r.limits[key]=Number(e.target.value);return r;})}/></label>)}
                  <label className="field field-wide"><span>Expiry (UTC)</span><input type="datetime-local"
                    value={utcDateTimeInput(draft.limits.expiresAt)}
                    onChange={e=>{const iso=parseUtcDateTimeInput(e.currentTarget.value);if(iso)update(r=>{r.limits.expiresAt=iso;return r;});}}
                    onInput={e=>{const iso=parseUtcDateTimeInput(e.currentTarget.value);if(iso)update(r=>{r.limits.expiresAt=iso;return r;});}}
                    onBlur={e=>{const iso=parseUtcDateTimeInput(e.currentTarget.value);if(iso)update(r=>{r.limits.expiresAt=iso;return r;});}}/></label>
                </div>
                <div className="guard-tags">{["Fresh chain state","Authorized bot","Tick / lot","Cross-margin","Onchain sizing","Lease held","Deduplicate","No auto-retry"].map(tag=>
                  <span key={tag}><Check size={12}/>{tag}</span>)}</div>
              </Panel>
            </div>
            <div className="studio-aside">
              <Panel title="05 / Validate & arm" subtitle="Controlled workflow, not a one-click trading bot"
                className="sticky-panel">
                <div className="readiness">
                  <div className="readiness-title"><strong>Rule validation</strong>
                    <Pill tone={report?.valid?"green":"red"}>{report?.valid?"VALID":"BLOCKED"}</Pill></div>
                  {report?.errors.length?<ul className="validation-errors">{report.errors.map((e,i)=><li key={i}><CircleAlert size={14}/>{e}</li>)}</ul>:
                    <div className="validation-good"><CheckCircle2 size={17}/> Structure and static contradictions checked.</div>}
                  {report?.warnings.map((w,i)=><p className="validation-warning" key={i}>{w}</p>)}
                </div>
                <div className="readiness-steps">
                  <div><CheckCircle2 size={17} className={report?.valid?"ok":""}/> Rule validated</div>
                  <div><Save size={17} className={savedId&&!dirty?"ok":""}/> Saved immutable version</div>
                  <div><Activity size={17} className={simulationStored?"ok":""}/> Simulation recorded</div>
                  <div><LockKeyhole size={17}/> Explicit authorization</div>
                </div>
                <button className="button button-outline full" disabled={!report?.valid||busy||!ownerAuthorized} onClick={saveDraft}>
                  <Save size={16}/>{savedId?"Save new version":"Save draft"}</button>
                <button className="button button-subtle full" disabled={!report?.valid||busy} onClick={simulate}>
                  <Play size={16}/> Simulate conditions</button>
                <button className="button button-primary full" disabled={!ownerAuthorized||!savedId||dirty||!simulationStored||busy}
                  onClick={arm}><Zap size={16}/> ARM STRATEGY</button>
                {!ownerAuthorized&&<p className="small-note">{authUserId?"This signed-in identity is not approved for owner controls yet.":"Sign in as the approved trader under Settings to save or arm a rule."}</p>}
                {simulation&&<div className="simulation-result">
                  <div className="sim-top"><strong>SIMULATION</strong>
                    <Pill tone={simulation.matched?"green":"amber"}>{simulation.matched?"MATCH":"SKIP"}</Pill></div>
                  <div>{simulation.conditions} conditions matched</div><small>{simulation.source}</small>
                  <p>No transaction is submitted by a simulation.</p>
                </div>}
                <div className="safety-note"><ShieldCheck size={18}/>
                  <p>Arming a rule is separate from enabling execution. The Fly worker requires a linked key, healthy lease, global resume and server-side opt-in.</p></div>
              </Panel>
            </div>
          </div>
          {ownerAuthorized&&<Panel title="Saved strategies" subtitle="Owner-only control plane">
            {strategies.length?<div className="strategies-table">{strategies.map(s=>
              <div className="strategy-row" key={s.id}>
                <div><strong>{s.name}</strong><span>Version {s.current_version} · {short(s.id,8)}</span></div>
                <Pill tone={s.state==="armed"?"green":s.state==="paused"?"amber":"neutral"}>{s.state.toUpperCase()}</Pill>
                <button className="button button-subtle" onClick={()=>{
                  const version=s.strategy_versions.find(v=>v.version===s.current_version);
                  if(version){setDraft(version.rule);setSavedId(s.id);setSimulation(null);setSimulationStored(false);setDirty(false);}
                }}>Edit</button>
                {s.state==="armed"&&<button className="button button-danger" disabled={busy}
                  onClick={()=>void pauseStrategy(s.id)}><Pause size={15}/> Pause</button>}
              </div>)}</div>:<Empty title="No saved strategies" description="Validate and save your first rule above." icon={Layers3}/>}
          </Panel>}
        </>}
        {tab==="Markets"&&<>
          <div className="metrics-grid">
            <MetricCard label="MARKETS TRACKED" value={String(latestMarkets.length)} icon={BarChart3} note="From actual chain snapshots"/>
            <MetricCard label="CHAIN" value="50383" icon={Globe2} note="Somnia Hideki"/>
            <MetricCard label="LATEST BLOCK" value={short(status?.block,8)} icon={Layers3} note="From the engine"/>
            <MetricCard label="FEED" value={status?.healthy?"CONNECTED":"OFFLINE"} icon={Radio} note="15-second dashboard refresh"/>
          </div>
          <Panel title="Perpetual markets" subtitle="Mark/index values and funding normalization are read by the Fly service">
            {latestMarkets.length?<div className="responsive-table"><table><thead><tr>
              <th>Market</th><th>Mark USD</th><th>Index USD</th><th>Premium</th><th>Funding / 8h</th><th>Open interest</th><th>Observed</th>
            </tr></thead><tbody>{latestMarkets.map(m=><tr key={m.symbol}>
              <td><b>{m.symbol}-PERP</b></td><td>${fmt(m.metrics.markUsd)}</td>
              <td>${fmt(m.metrics.indexUsd)}</td>
              <td>{fmt(m.metrics.premiumBps)} bps</td><td>{fmt(m.metrics.fundingBps8h)} bps</td>
              <td>${fmt(m.metrics.openInterestUsd,0)}</td>
              <td>{ago(m.observed_at)}</td></tr>)}</tbody></table></div>:
              <Empty title="No connected market data" description="Launch the Fly worker and allow real contract reads on Hideki." icon={BarChart3}/>}
          </Panel>
        </>}
        {tab==="Live Pulse"&&<div className="two-column wide-left">
          <Panel title="Observation feed" subtitle="Unmatched conditions are useful evidence, not failures"
            right={<Pill tone={status?.healthy?"green":"amber"}><Radio size={11}/> {status?.healthy?"STREAMING":"AWAITING ENGINE"}</Pill>}>
            {traces.length?<div className="pulse-list">{traces.slice(0,20).map(t=><div className="pulse-item" key={t.id}>
              <span className="pulse-track"/><span className="pulse-dot"/>
              <div><div className="pulse-title">{t.market_events?.kind??"Decision"} <Pill tone={t.status==="blocked"?"amber":"neutral"}>{t.status}</Pill></div>
                <p>{t.market_events?.market??"—"}-PERP · Block {t.market_events?.block_number??"—"} · {ago(t.recorded_at)}</p>
                {t.risk.blockedBy?.length?<small>Guard: {t.risk.blockedBy.join(", ")}</small>:null}</div>
            </div>)}</div>:<Empty title="Awaiting real events" description="No onchain event has been evaluated and persisted yet." icon={Radio}/>}
          </Panel>
          <Panel title="Health contract" subtitle="Live decisions require these conditions">
            <div className="status-list">
              <StatusLine label="Engine heartbeat" value={status?.healthy?"Fresh":"Unknown"} tone={status?.healthy?"green":"amber"}/>
              <StatusLine label="Global control" value={status?.paused?"Paused":"Allow evaluation"} tone={status?.paused?"amber":"green"}/>
              <StatusLine label="Last chain head" value={short(status?.block,10)} tone="neutral"/>
              <StatusLine label="Replay protection" value="Required" tone="green"/>
              <StatusLine label="Signer isolation" value="Fly secret only" tone="green"/>
            </div>
          </Panel>
        </div>}
        {tab==="Positions & Risk"&&<>
          <div className="metrics-grid">
            <MetricCard label="ACCOUNT EQUITY" value={overview?.account?`$${fmt(overview.account.equityUsd)}`:"—"} icon={Wallet2} note="DreamDEX MarginBank"/>
            <MetricCard label="FREE COLLATERAL" value={overview?.account?`$${fmt(overview.account.availableMarginUsd)}`:"—"} icon={ShieldCheck} note="USDso available"/>
            <MetricCard label="LOCKED COLLATERAL" value={overview?.account?`$${fmt(overview.account.lockedMarginUsd)}`:"—"} icon={LockKeyhole} note="Margin held"/>
            <MetricCard label="ACTIVE POSITIONS" value={String(overview?.account?.positions.length??"—")} icon={Activity} note="Owned testnet account"/>
          </div>
          <Panel title="Current positions" subtitle="From live account reads — no simulated holdings">
            {overview?.account?.positions.length?<div className="responsive-table"><table><thead><tr>
              <th>Market</th><th>Signed position</th><th>Mark</th><th>Notional</th>
            </tr></thead><tbody>{overview.account.positions.map(p=><tr key={p.market}>
              <td>{p.market}-PERP</td><td>{p.size}</td><td>${fmt(p.markUsd)}</td>
              <td>${fmt(p.notionalUsd)}</td></tr>)}</tbody></table></div>:
              <Empty title="No verified open positions" description="Positions appear only after the live engine publishes MarginBank account state." icon={Wallet2}/>}
          </Panel>
          <Panel title="Risk policy" subtitle="Applied after all AND/OR market logic">
            <div className="guard-tags">{["Owner grant verified","Account notional ceiling","Margin available","Live oracle health","Max daily actions","Cooldown","Unique intent","Uncertain TX quarantine"].map(x=>
              <span key={x}><ShieldCheck size={13}/>{x}</span>)}</div>
            <div className="banner-warning space-top"><CircleAlert size={18}/> Pausing THRYNT does not cancel resting orders, close existing positions or prevent a market liquidation.</div>
          </Panel>
        </>}
        {tab==="Decision Trace"&&<Panel title="Proof ledger" subtitle="Application evidence + verifiable onchain receipts">
          {traces.length?<div className="trace-list">{traces.map(t=><TraceCard key={t.id} trace={t}/>)}</div>:
            <Empty title="Evidence ledger is empty" description="No real events have been written; this page never invents transaction hashes." icon={History}/>}
        </Panel>}
        {tab==="Settings"&&<div className="two-column">
          <Panel title="Trader authentication" subtitle="Supabase Auth and an owner-user allowlist">
            {authUserId?<div className="signed-in"><span className="signed-icon"><Check size={20}/></span>
              <div><strong>Signed in</strong><p>{trader??"Authenticated session"}</p><p className="small-note">{ownerAuthorized?"Approved owner controls active":"Authenticated, but not approved for owner controls"}</p></div>
              <button className="button button-outline" onClick={logout}>Sign out</button></div>:
              <div className="auth-form"><label className="field"><span>Authorized trader email</span>
                <input placeholder="your@email.com" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
                <button className="button button-primary" onClick={()=>void sendMagicLink()} disabled={busy||!email.includes("@")}>
                  <KeyRound size={16}/> Send secure sign-in link</button></div>}
            {authMessage&&<p className="small-note">{authMessage}</p>}
            <div className="help"><LockKeyhole size={14}/> Logging in does not grant owner rights. The Cloudflare API enforces one approved Supabase user ID.</div>
          </Panel>
          <Panel title="Linked bot configuration" subtitle="No private key is ever entered in this website">
            <div className="setup-list">
              <div><span>01</span><p>Create a dedicated testnet bot wallet with STT for gas.</p></div>
              <div><span>02</span><p>Fund your DreamDEX owner MarginBank with testnet USDso.</p></div>
              <div><span>03</span><p>DreamDEX → Link a Bot → Perps; authorize the bot address for the selected pools.</p></div>
              <div><span>04</span><p>Store the bot private key and owner address only as Fly.io secrets.</p></div>
            </div>
            <a className="external" href="https://app.testnet.dreamdex.io" target="_blank" rel="noopener noreferrer">
              Open DreamDEX testnet <ExternalLink size={14}/></a>
          </Panel>
          <Panel title="Emergency execution controls" subtitle="A separate owner action, never conflated with position closure">
            <div className="safety-note"><CircleAlert size={19}/><p>Global pause blocks new THRYNT submissions. It cannot revoke an onchain linked-bot grant or automatically liquidate a position.</p></div>
            <div className="button-row"><button className="button button-danger" disabled={!ownerAuthorized||busy} onClick={()=>void emergency(true)}>
              <Ban size={15}/> PAUSE NEW ENTRIES</button>
              <button className="button button-outline" disabled={!ownerAuthorized||busy} onClick={()=>void emergency(false)}>
                <Play size={15}/> RESUME EVALUATION</button></div>
            <p className="small-note">For an actual emergency, also revoke operator permissions in DreamDEX and inspect/cancel exchange orders manually.</p>
          </Panel>
          <Panel title="Deployment stack" subtitle="Three hosting roles plus one database">
            <div className="status-list">
              <StatusLine label="Client interface" value="Vercel / Next.js" tone="green"/>
              <StatusLine label="Secure public API" value="Cloudflare Workers" tone="green"/>
              <StatusLine label="Always-on event runner" value="Fly.io Machine" tone="green"/>
              <StatusLine label="Evidence + persistence" value="Supabase Postgres" tone="green"/>
              <StatusLine label="Exchange" value="DreamDEX / Somnia" tone="green"/>
            </div>
          </Panel>
        </div>}
        <footer><span>THRYNT · SET THE CONDITION. PROVE THE EXECUTION.</span>
          <span>TESTNET ENGINEERING DEMONSTRATION · NOT FINANCIAL ADVICE</span></footer>
      </main>
    </div>
    {notice&&<div className={`toast ${notice.error?"toast-error":""}`}>
      {notice.error?<CircleAlert size={17}/>:<CheckCircle2 size={17}/>}
      <span>{notice.message}</span><button onClick={()=>setNotice(null)}><X size={15}/></button></div>}
  </div>;
}

function MetricCard({label,value,note,icon:Icon}:{label:string;value:string;note:string;icon:typeof Activity}) {
  return <div className="metric-card"><div className="metric-head"><span>{label}</span><Icon size={17}/></div>
    <strong>{value}</strong><small><span className="mini-dot"/>{note}</small></div>;
}
function StatusLine({label,value,tone}:{label:string;value:string;tone:"green"|"amber"|"red"|"neutral"}) {
  return <div className="status-line"><span>{label}</span><span className={`status-value status-${tone}`}>
    <CircleDot size={11}/>{value}</span></div>;
}
function TrendingGlyph(){return <Activity size={19}/>;}
function TraceCard({trace:t}:{trace:Trace}) {
  const [expanded,setExpanded]=useState(false);
  const tx=t.execution_intents?.find(x=>x.tx_hash);
  const link=tx?.tx_hash?`https://explorer.testnet.somnia.network/tokyo/tx/${tx.tx_hash}`:null;
  return <div className="trace-card">
    <button className="trace-summary" onClick={()=>setExpanded(x=>!x)} aria-expanded={expanded}>
      <span className="trace-symbol"><GitBranch size={17}/></span>
      <div><strong>{t.market_events?.kind??"Strategy evaluation"}</strong>
        <p>{t.market_events?.market??"—"}-PERP · Block {t.market_events?.block_number??"—"} · {ago(t.recorded_at)}</p></div>
      <Pill tone={t.status==="blocked"?"amber":t.status==="confirmed"?"green":"neutral"}>{t.status.toUpperCase()}</Pill>
      <ChevronDown className={expanded?"flip":""} size={18}/>
    </button>
    {expanded&&<div className="trace-details">
      <div><span>Event transaction</span><code>{t.market_events?.transaction_hash??"—"}</code></div>
      <div><span>Condition result</span><strong>{t.evaluation.matched?"Matched":"Unmatched / blocked"}</strong></div>
      <div><span>Risk verdict</span><strong>{t.risk.blockedBy?.join(", ")||"No mandatory block recorded"}</strong></div>
      <div><span>Submission</span><strong>{tx?.status??"No order submitted"}{tx?.receipt_status?` · receipt ${tx.receipt_status}`:""}</strong></div>
      <div><span>Protocol outcome</span><strong>{tx?.order_state??"Not reconciled"}{tx?.order_id?` · order ${tx.order_id}`:""}</strong></div>
      {link&&<a href={link} target="_blank" rel="noopener noreferrer">Inspect transaction on Somnia Explorer <ExternalLink size={14}/></a>}
      <p className="small-note">The transaction receipt is independently verifiable. Strategy rationale is an application-generated record, not a cryptographic proof of honest evaluation.</p>
    </div>}
  </div>;
}
