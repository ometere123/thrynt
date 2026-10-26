import "dotenv/config";
import {getAddress, isAddress} from "viem";
export interface EngineConfig {
  apiUrl:string;apiKey:string;instance:string;owner:`0x${string}`;
  botPrivateKey?:`0x${string}`;mode:"observe"|"simulate"|"live";
  liveOptIn:boolean;rpc:string;ws:string;indexer:string;
}
export function configFromEnv(env:NodeJS.ProcessEnv=process.env):EngineConfig {
  const apiUrl=env.THRYNT_API_URL?.trim()??"";
  const apiKey=env.THRYNT_ENGINE_API_KEY??"";
  const owner=env.OWNER_ADDRESS??"";
  const mode=env.EXECUTION_MODE??"observe";
  if(!apiUrl.startsWith("https://")&&!apiUrl.startsWith("http://localhost:"))
    throw new Error("THRYNT_API_URL must be HTTPS outside localhost");
  if(apiKey.length<32)throw new Error("THRYNT_ENGINE_API_KEY must be a strong, long secret");
  if(!isAddress(owner)||getAddress(owner)==="0x0000000000000000000000000000000000000000")
    throw new Error("Set a real testnet OWNER_ADDRESS");
  if(!["observe","simulate","live"].includes(mode))throw new Error("Unsupported execution mode");
  const privateKey=env.BOT_PRIVATE_KEY;
  if(mode==="live"&&(!privateKey||!/^0x[a-fA-F0-9]{64}$/.test(privateKey)))
    throw new Error("Live mode requires a dedicated linked BOT_PRIVATE_KEY");
  const rpc=env.SOMNIA_RPC_URL??"https://api.hideki2.infra.testnet.somnia.network";
  const ws=env.SOMNIA_WS_URL??"wss://api.hideki2.infra.testnet.somnia.network/ws";
  if(!ws.startsWith("wss://"))throw new Error("Somnia WebSocket must be secure");
  return {
    apiUrl:apiUrl.replace(/\/$/,""),apiKey,instance:env.ENGINE_INSTANCE_ID??"thrynt-fly-1",
    owner:getAddress(owner),
    botPrivateKey:privateKey as `0x${string}`|undefined,
    mode:mode as EngineConfig["mode"],
    liveOptIn:env.ENABLE_TESTNET_EXECUTION==="true",
    rpc,ws,indexer:env.SOMNIA_INDEXER_URL??"https://hideki-dev.smk.somnia.host/v1/graphql",
  };
}
