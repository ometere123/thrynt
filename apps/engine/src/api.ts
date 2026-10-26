import type {Rule} from "@thrynt/core";
import type {EngineConfig} from "./config.js";

export interface StoredStrategy {
  id:string;state:string;current_version:number;
  strategy_versions:{id:string;version:number;rule:Rule;fingerprint:string}[];
}
export interface EngineState {
  strategies:StoredStrategy[];
  status:{global_pause:boolean;lease_holder:string|null;lease_until:string|null;lease_generation:string|number|null};
}
export class ThryntApi {
  constructor(private readonly config:EngineConfig){}
  async request<T>(path:string,body?:unknown):Promise<T> {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12_000);
    try {
      const response=await fetch(this.config.apiUrl+path,{
        method:body===undefined?"GET":"POST",
        headers:{"Content-Type":"application/json","X-Engine-Key":this.config.apiKey},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,
      });
      const data=await response.json() as T & {error?:string};
      if(!response.ok)throw new Error(`API ${response.status} ${path}: ${data.error??"request rejected"}`);
      return data;
    } finally {clearTimeout(timeout);}
  }
  lease(){return this.request<{acquired:boolean;generation:string|null}>("/v1/engine/lease",{instance:this.config.instance});}
  state(){return this.request<EngineState>("/v1/engine/strategies");}
  heartbeat(generation:string,block:string|null,error:string|null){
    return this.request("/v1/engine/heartbeat",{instance:this.config.instance,generation,block,error});
  }
  market(snapshot:unknown){return this.request("/v1/engine/market",snapshot);}
  account(snapshot:unknown){return this.request("/v1/engine/account",snapshot);}
  event(value:unknown){return this.request("/v1/engine/event",value);}
  decision(value:unknown){return this.request<{id:string;created:boolean}>("/v1/engine/decision",value);}
  activity(id:string){return this.request<{actionsToday:number;lastActionAt:string|null}>(`/v1/engine/activity/${id}`);}
  reserve(value:unknown){return this.request<{created:boolean;id:string|null;reason?:string}>("/v1/engine/intent",value);}
  intentStatus(id:string,value:unknown){return this.request(`/v1/engine/intent/${id}/status`,value);}
  unresolved(){return this.request<{intents:{id:string;status:string;tx_hash:string|null;order_id:string|null;result:Record<string,unknown>;action:Record<string,unknown>;pool_address:string|null;created_at:string}[]}>("/v1/engine/unresolved");}
  pause(id:string){return this.request(`/v1/engine/pause/${id}`,{});}
}
