import {validateState,MAX_RECORDS,SYNC_KEY_PATTERN} from "../src/model.js";

const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
export function allowedOrigin(request,env) {
  const origin=request.headers.get("Origin");
  if(!origin)return null;
  const list=String(env.ALLOWED_ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean);
  if(!list.includes(origin))throw new HttpError(403,"此网站未获准连接，请在 Worker 中配置 ALLOWED_ORIGINS");
  return origin;
}
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export function responseJson(value,status=200,origin=null) {
  const headers={...JSON_HEADERS};
  if(origin){headers["Access-Control-Allow-Origin"]=origin;headers.Vary="Origin";}
  return new Response(JSON.stringify(value),{status,headers});
}
export async function ownerId(request) {
  const auth=request.headers.get("Authorization")||"";
  const key=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!SYNC_KEY_PATTERN.test(key))throw new HttpError(401,"同步密钥不正确，请粘贴完整的个人密钥");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
export function checkPayload(input,now=Date.now()) {
  let state;
  try{state=validateState(input);}catch(error){throw new HttpError(400,error.message);}
  for(const value of [...Object.values(state.records),...(state.recovery?[state.recovery]:[])]) {
    if(value.updatedAt>now+300000)throw new HttpError(400,"设备时间超前，请校准后重新同步");
  }
  return state;
}
async function readState(db,owner) {
  const [records,recovery]=await db.batch([
    db.prepare("SELECT day, status, occurred_at, updated_at, mutation_id FROM records WHERE owner_id = ? ORDER BY day LIMIT ?").bind(owner,MAX_RECORDS+1),
    db.prepare("SELECT start, updated_at, mutation_id FROM recovery WHERE owner_id = ?").bind(owner)
  ]);
  if(records.results.length>MAX_RECORDS)throw new HttpError(413,"记录数量超出限制");
  const entries={};
  for(const row of records.results)entries[row.day]={date:row.day,status:row.status,occurredAt:row.occurred_at,updatedAt:row.updated_at,mutationId:row.mutation_id};
  const setting=recovery.results[0];
  return {version:1,records:entries,recovery:setting?{start:setting.start,updatedAt:setting.updated_at,mutationId:setting.mutation_id}:null};
}
export const RECORD_UPSERT=`INSERT INTO records (owner_id, day, status, occurred_at, updated_at, mutation_id)
SELECT ?, json_extract(value, '$.date'), json_extract(value, '$.status'), json_extract(value, '$.occurredAt'), json_extract(value, '$.updatedAt'), json_extract(value, '$.mutationId')
FROM json_each(?) WHERE true
ON CONFLICT(owner_id, day) DO UPDATE SET status=excluded.status, occurred_at=excluded.occurred_at, updated_at=excluded.updated_at, mutation_id=excluded.mutation_id
WHERE excluded.updated_at > records.updated_at OR (excluded.updated_at = records.updated_at AND excluded.mutation_id > records.mutation_id)`;
export const RECOVERY_UPSERT=`INSERT INTO recovery (owner_id, start, updated_at, mutation_id)
VALUES (?, ?, ?, ?)
ON CONFLICT(owner_id) DO UPDATE SET start=excluded.start, updated_at=excluded.updated_at, mutation_id=excluded.mutation_id
WHERE excluded.updated_at > recovery.updated_at OR (excluded.updated_at = recovery.updated_at AND excluded.mutation_id > recovery.mutation_id)`;
async function writeState(db,owner,state) {
  const existing=await db.prepare("SELECT day FROM records WHERE owner_id = ?").bind(owner).all();
  const union=new Set([...existing.results.map(r=>r.day),...Object.keys(state.records)]);
  if(union.size>MAX_RECORDS)throw new HttpError(413,"记录数量超出限制");
  const records=Object.values(state.records),statements=[];
  // 使用 JSON 批量写入，避免每条记录消耗一次 D1 查询。
  for(let i=0;i<records.length;i+=1000)statements.push(db.prepare(RECORD_UPSERT).bind(owner,JSON.stringify(records.slice(i,i+1000))));
  if(state.recovery)statements.push(db.prepare(RECOVERY_UPSERT).bind(owner,state.recovery.start,state.recovery.updatedAt,state.recovery.mutationId));
  // 最多 40 个记录写入语句，可在免费 Worker 的查询限额内完成。
  if(statements.length)await db.batch(statements);
}
async function limitedJson(request) {
  const max=8_000_000;
  if(Number(request.headers.get("Content-Length")||0)>max)throw new HttpError(413,"同步数据过大");
  if(!request.body)throw new HttpError(400,"缺少同步数据");
  const reader=request.body.getReader(),chunks=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw new HttpError(413,"同步数据过大");}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,"同步数据不是有效 JSON");}
}
export default {
  async fetch(request,env) {
    let origin=null;
    try {
      origin=allowedOrigin(request,env);
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...(origin?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"86400",Vary:"Origin"}});
      const path=new URL(request.url).pathname;
      if(path==="/api/health"&&request.method==="GET")return responseJson({ok:true,service:"lulema"},200,origin);
      if(!["/api/state","/api/sync"].includes(path))throw new HttpError(404,"接口不存在");
      if((path==="/api/state"&&request.method!=="GET")||(path==="/api/sync"&&request.method!=="POST"))throw new HttpError(405,"不支持的请求方法");
      const owner=await ownerId(request);
      if(!env.DB)throw new HttpError(503,"D1 数据库尚未配置");
      if(path==="/api/sync") {
        if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))throw new HttpError(415,"请使用 JSON 数据格式");
        const state=checkPayload(await limitedJson(request));await writeState(env.DB,owner,state);
      }
      return responseJson(await readState(env.DB,owner),200,origin);
    } catch(error) {
      if(error instanceof HttpError)return responseJson({error:error.message},error.status,origin);
      console.error("lulema database request failed",error?.name);
      return responseJson({error:"云端暂时不可用，请确认数据库迁移已执行，稍后重试"},503,origin);
    }
  }
};
