// 先启动本机 Wrangler；该检查仅允许访问 localhost 的测试接口。
import assert from "node:assert/strict";
import {createSyncKey,emptyState,setRecord,deleteRecord,setRecovery,dateKey} from "../src/model.js";
const base=process.env.LULEMA_TEST_API||"http://127.0.0.1:8787";
const url=new URL(base);if(!["127.0.0.1","localhost"].includes(url.hostname))throw new Error("Only a local test Worker is allowed");
const key=createSyncKey(),anotherKey=createSyncKey();
async function call(path,state=null,secret=key){return fetch(base+path,{method:state?"POST":"GET",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json",Origin:"http://127.0.0.1:4173"},...(state?{body:JSON.stringify(state)}:{})});}
assert.equal((await call("/api/health")).status,200);
assert.equal((await call("/api/v2/state",null,"invalid")).status,401);
let state=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T08:00:00Z",1);
state=setRecovery(state,"2026-11-01T00:00:00Z",2);
let response=await call("/api/v2/sync",state);assert.equal(response.status,200);assert.deepEqual(await response.json(),state);
assert.deepEqual(await (await call("/api/v2/state",null,anotherKey)).json(),emptyState());
const deleted=deleteRecord(state,Object.keys(state.records)[0],3);
assert.deepEqual(await (await call("/api/v2/sync",deleted)).json(),deleted);
assert.deepEqual(await (await call("/api/v2/sync",state)).json(),deleted);
const bulk=emptyState();for(let i=0;i<1100;i++){const at=new Date(2020,0,i+1,12),day=dateKey(at);const id=`smoke_${String(i).padStart(6,"0")}`;bulk.records[id]={id,date:day,status:"reset",occurredAt:at.toISOString(),updatedAt:i,mutationId:`smoke_${String(i).padStart(6,"0")}`};}
response=await call("/api/v2/sync",bulk,anotherKey);assert.equal(response.status,200);assert.equal(Object.keys((await response.json()).records).length,1100);
console.log("Real Cloudflare local runtime checks passed: health, authentication, D1 read/write, owner isolation, deletion, stale-write rejection, 1100-record batch.");
