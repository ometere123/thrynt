import "dotenv/config";
import {getAddress, isAddress} from "viem";
export interface EngineConfig {
  apiUrl:string;apiKey:string;instance:string;owner:`0x${string}`;
  botPrivateKey?:`0x${string}`;expectedBotAddress?:`0x${string}`;
  mode:"observe"|"simulate"|"live";
  liveOptIn:boolean;authorizedMaxPriceUsd?:number;authorizedMinSellPriceUsd?:number;
  rpc:string;ws:string;indexer:string;healthPort:number;
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
  const expectedBotAddress=env.EXPECTED_BOT_ADDRESS?.trim();
  if(expectedBotAddress&&!isAddress(expectedBotAddress))
    throw new Error("EXPECTED_BOT_ADDRESS must be a valid public address");
  if(mode==="live"&&!expectedBotAddress)
    throw new Error("Live mode requires EXPECTED_BOT_ADDRESS for linked-bot verification");
  const maxPriceRaw=env.THRYNT_AUTHORIZED_MAX_PRICE_USD?.trim();
  let authorizedMaxPriceUsd:number|undefined;
  if(maxPriceRaw) {
    const parsed=Number(maxPriceRaw);
    if(!Number.isFinite(parsed)||parsed<=0)
      throw new Error("THRYNT_AUTHORIZED_MAX_PRICE_USD must be a positive finite number");
    authorizedMaxPriceUsd=parsed;
  }
  const minSellPriceRaw=env.THRYNT_AUTHORIZED_MIN_SELL_PRICE_USD?.trim();
  let authorizedMinSellPriceUsd:number|undefined;
  if(minSellPriceRaw) {
    const parsed=Number(minSellPriceRaw);
    if(!Number.isFinite(parsed)||parsed<=0)
      throw new Error("THRYNT_AUTHORIZED_MIN_SELL_PRICE_USD must be a positive finite number");
    authorizedMinSellPriceUsd=parsed;
  }
  const rpc=env.SOMNIA_RPC_URL??"https://api.hideki2.infra.testnet.somnia.network";
  const ws=env.SOMNIA_WS_URL??"wss://api.hideki2.infra.testnet.somnia.network/ws";
  if(!rpc.startsWith("https://"))throw new Error("Somnia RPC must be HTTPS");
  if(!ws.startsWith("wss://"))throw new Error("Somnia WebSocket must be secure");
  const healthPort=Number(env.PORT??"8080");
  if(!Number.isInteger(healthPort)||healthPort<1||healthPort>65_535)
    throw new Error("PORT must be a valid TCP port");
  return {
    apiUrl:apiUrl.replace(/\/$/,""),apiKey,instance:env.ENGINE_INSTANCE_ID??"thrynt-fly-1",
    owner:getAddress(owner),
    botPrivateKey:privateKey as `0x${string}`|undefined,
    expectedBotAddress:expectedBotAddress?getAddress(expectedBotAddress):undefined,
    mode:mode as EngineConfig["mode"],
    liveOptIn:env.ENABLE_TESTNET_EXECUTION==="true",authorizedMaxPriceUsd,authorizedMinSellPriceUsd,
    rpc,ws,indexer:env.SOMNIA_INDEXER_URL??"https://hideki-dev.smk.somnia.host/v1/graphql",healthPort,
  };
}
