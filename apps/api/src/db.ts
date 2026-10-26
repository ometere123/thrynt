import {createClient} from "@supabase/supabase-js";
export interface Env {
  SUPABASE_URL: string; SUPABASE_SECRET_KEY: string; ENGINE_API_KEY: string;
  TRADER_USER_ID: string; ALLOWED_ORIGIN: string;
}
export function db(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Database server secrets missing");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {persistSession:false,autoRefreshToken:false},
  });
}
export async function authorizedUser(env: Env, authorization?: string): Promise<string|null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.TRADER_USER_ID) return null;
  const {data,error} = await db(env).auth.getUser(token);
  if (error || !data.user || data.user.id !== env.TRADER_USER_ID) return null;
  return data.user.id;
}
export async function secureEngineKey(provided?: string, expected?: string): Promise<boolean> {
  if (!provided || !expected || expected.length < 32) return false;
  const enc = new TextEncoder();
  const [a,b] = await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(provided)),
    crypto.subtle.digest("SHA-256",enc.encode(expected)),
  ]);
  const aa = new Uint8Array(a);const bb = new Uint8Array(b);
  let difference = 0;
  for (let i=0;i<aa.length;i++) difference |= aa[i]! ^ bb[i]!;
  return difference===0;
}
function canonical(v:unknown):string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v==="object") {
    const r=v as Record<string,unknown>;
    return `{${Object.keys(r).sort().map(k=>`${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export async function fingerprint(v:unknown):Promise<string> {
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(v)));
  return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
