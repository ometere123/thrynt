"use client";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
let singleton:SupabaseClient|null=null;
export class ApiRequestError extends Error {
  constructor(message:string,readonly status:number){super(message);this.name="ApiRequestError";}
}
export function authClient():SupabaseClient|null {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return null;
  singleton??=createClient(url,key,{auth:{autoRefreshToken:true,persistSession:true}});
  return singleton;
}
export async function publicGet<T>(path:string):Promise<T> {
  const base=process.env.NEXT_PUBLIC_API_URL;
  if(!base)throw new Error("Public API URL is not configured");
  const response=await fetch(base+path,{cache:"no-store"});
  if(!response.ok)throw new Error(`API unavailable: ${response.status}`);
  return response.json() as Promise<T>;
}
export async function ownerPost<T>(path:string,body?:unknown):Promise<T> {
  const auth=authClient();
  const {data}=await auth?.auth.getSession()??{data:{session:null}};
  if(!data.session?.access_token)throw new Error("Sign in as the authorized trader first");
  const base=process.env.NEXT_PUBLIC_API_URL;
  if(!base)throw new Error("Public API URL is not configured");
  const response=await fetch(base+path,{
    method:"POST",headers:{
      "Authorization":`Bearer ${data.session.access_token}`,
      "Content-Type":"application/json",
    },body:JSON.stringify(body??{}),
  });
  const payload=await response.json();
  if(!response.ok)throw new ApiRequestError(payload.error??payload.errors?.join(", ")??"Request rejected",response.status);
  return payload as T;
}
export async function ownerGet<T>(path:string):Promise<T> {
  const auth=authClient();
  const {data}=await auth?.auth.getSession()??{data:{session:null}};
  if(!data.session?.access_token)throw new Error("Sign in first");
  const response=await fetch((process.env.NEXT_PUBLIC_API_URL??"")+path,{
    headers:{"Authorization":`Bearer ${data.session.access_token}`},cache:"no-store",
  });
  const payload=await response.json();
  if(!response.ok)throw new ApiRequestError(payload.error??"Request rejected",response.status);
  return payload as T;
}
