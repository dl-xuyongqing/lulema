import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker,{ownerId,checkPayload} from "../worker/api.js";
import {emptyState,setRecord,deleteRecord,validateState,recordsForDay,setRecovery,createSyncKey} from "../src/model.js";
class D1 {
  constructor(){this.db=new DatabaseSync(":memory:");this.db.exec(readFileSync(new URL("../worker/migrations/0001_initial.sql",import.meta.url),"utf8"));this.db.exec(readFileSync(new URL("../worker/migrations/0002_multiple_records.sql",import.meta.url),"utf8"));}
  prepare(sql){const db=this.db;return {bind(...params){return {async all(){return {results:db.prepare(sql).all(...params)};},async first(){return db.prepare(sql).get(...params)||null;},query(){return {results:db.prepare(sql).all(...params)};}};}};}
  async batch(queries){this.db.exec("BEGIN");try{const result=queries.map(q=>q.query());this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
function setup(){const db=new D1(),key=createSyncKey(),env={DB:db,ALLOWED_ORIGINS:"https://dl-xuyongqing.github.io"};
  async function call(path,body,customKey=key,origin="https://dl-xuyongqing.github.io"){
    return worker.fetch(new Request(`https://api.example${path}`,{method:body?"POST":"GET",headers:{Origin:origin,Authorization:`Bearer ${customKey}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),env);
  }return {db,key,env,call};
}
test("真实 SQLite 执行迁移和批量写入，用户空间隔离",async()=>{
  const {call,db,key}=setup();let s=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T08:00:00Z",1);s=setRecord(s,"2026-11-02","reset","2026-11-02T08:00:00Z",2);s=setRecovery(s,"2026-11-01T00:00:00Z",3);
  const res=await call("/api/v2/sync",s);assert.equal(res.status,200);assert.deepEqual(await res.json(),s);
  const another=await call("/api/v2/state",null,createSyncKey());assert.deepEqual(await another.json(),emptyState());
  const owner=await ownerId(new Request("https://api.example",{headers:{Authorization:`Bearer ${key}`}}));assert.equal(owner.length,64);assert.notEqual(owner,key);
  assert.equal(db.db.prepare("SELECT owner_id FROM record_entries LIMIT 1").get().owner_id,owner);
});
test("重复上传幂等，旧记录不覆盖新修改或删除",async()=>{
  const {call}=setup(),old=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T08:00:00Z",1),removed=deleteRecord(old,Object.keys(old.records)[0],2);
  await call("/api/v2/sync",old);await call("/api/v2/sync",removed);const repeated=await call("/api/v2/sync",old);assert.deepEqual(await repeated.json(),removed);
  assert.deepEqual(await (await call("/api/v2/sync",removed)).json(),removed);
});
test("大量记录通过 JSON 批量写入，跨批次保持完整",async()=>{
  const {call}=setup();let s=emptyState();
  for(let i=0;i<1100;i++){const date=new Date(2020,0,i+1,12),day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;const id=`record_${String(i).padStart(5,"0")}`;s.records[id]={id,date:day,status:"reset",occurredAt:date.toISOString(),updatedAt:i,mutationId:`record_${String(i).padStart(5,"0")}`};}
  const result=await call("/api/v2/sync",s);assert.equal(result.status,200);assert.equal(Object.keys((await result.json()).records).length,1100);
});
test("跨域、密钥、输入和方法检查",async()=>{
  const {call,env}=setup();assert.equal((await call("/api/v2/state",null,"bad-key")).status,401);assert.equal((await call("/api/v2/state",null,createSyncKey(),"https://untrusted.example")).status,403);
  const bad=await call("/api/v2/sync",{version:1,records:{"2026-11-01":{status:"oops"}}});assert.equal(bad.status,400);
  const preflight=await worker.fetch(new Request("https://api.example/api/state",{method:"OPTIONS",headers:{Origin:"https://dl-xuyongqing.github.io"}}),env);assert.equal(preflight.status,204);assert.equal(preflight.headers.get("Access-Control-Allow-Origin"),"https://dl-xuyongqing.github.io");
  assert.equal((await call("/api/health")).status,200);assert.equal((await call("/unknown")).status,404);assert.equal((await call("/api/v2/state",emptyState())).status,405);
});
test("数据库未配置和超前设备时钟有明确错误",async()=>{
  const req=new Request("https://api.example/api/state",{headers:{Authorization:`Bearer ${createSyncKey()}`}});const res=await worker.fetch(req,{});assert.equal(res.status,503);
  const s=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T08:00:00Z",1000000);assert.throws(()=>checkPayload(s,0),/设备时间/);
});
test("云端拒绝未来事件且不写入，接受当前事件和设备时区日期",async()=>{
  const {call,db}=setup(),now=Date.now(),at=new Date(now-60000),s=setRecord(emptyState(),`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,"0")}-${String(at.getDate()).padStart(2,"0")}`,"reset",at.toISOString()),id=Object.keys(s.records)[0];
  const future={...s,records:{[id]:{...s.records[id],occurredAt:new Date(now+60000).toISOString()}}};
  const response=await call("/api/v2/sync",future);assert.equal(response.status,400);assert.match((await response.json()).error,/晚于现在/);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM record_entries").get().count,0);
  const latestDate=new Date(now+14*3600000).toISOString().slice(0,10);
  assert.doesNotThrow(()=>checkPayload({...s,records:{[id]:{...s.records[id],date:latestDate,occurredAt:new Date(now).toISOString()}}},now));
  assert.throws(()=>checkPayload({...s,records:{[id]:{...s.records[id],date:new Date(now+3*86400000).toISOString().slice(0,10)}}},now),/未来日期/);
  assert.equal((await call("/api/v2/sync",s)).status,200);
});
test("旧日记录迁移保留原时间和删除标记，旧设备更新也能合并",async()=>{
  const {call,db,key}=setup();
  const owner=await ownerId(new Request("https://api.example",{headers:{Authorization:`Bearer ${key}`}}));
  db.db.prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)").run(owner,"2026-11-01","reset","2026-11-01T03:00:00Z",1,"legacy_001");
  db.db.prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)").run(owner,"2026-11-02",null,null,2,"legacy_002");
  db.db.exec(readFileSync(new URL("../worker/migrations/0002_multiple_records.sql",import.meta.url),"utf8"));
  let remote=await (await call("/api/v2/state")).json();assert.equal(remote.records["day_2026-11-01"].occurredAt,"2026-11-01T03:00:00Z");assert.equal(remote.records["day_2026-11-02"].status,null);
  remote=deleteRecord(remote,"day_2026-11-01",3);await call("/api/v2/sync",remote);
  const result=await (await call("/api/v2/state")).json();assert.equal(result.records["day_2026-11-01"].status,null);
  const legacy={version:1,records:{"2026-11-02":{date:"2026-11-02",status:"clear",occurredAt:null,updatedAt:4,mutationId:"legacy_004"}},recovery:null};
  assert.equal((await call("/api/sync",legacy)).status,200);
  assert.equal((await (await call("/api/v2/state")).json()).records["day_2026-11-02"].status,"clear");
});
test("云端同一天两台设备新增保留两条，删除只影响指定记录",async()=>{
  const {call}=setup(),a=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T01:00:00Z",1),b=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T02:00:00Z",2);
  await call("/api/v2/sync",a);let remote=await (await call("/api/v2/sync",b)).json();assert.equal(recordsForDay(remote,"2026-11-01").length,2);
  remote=deleteRecord(remote,Object.keys(a.records)[0],3);await call("/api/v2/sync",remote);remote=await (await call("/api/v2/sync",a)).json();
  assert.equal(recordsForDay(remote,"2026-11-01").length,1);assert.equal(recordsForDay(remote,"2026-11-01")[0].id,Object.keys(b.records)[0]);
});
