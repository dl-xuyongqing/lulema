import test from "node:test";
import assert from "node:assert/strict";
import {dateKey,parseDate,shiftDate,emptyState,setRecord,setRecovery,statistics,calendarDays,recoveryProgress,mergeStates,validateState,importBackup,createSyncKey,SYNC_KEY_PATTERN,normalizeApiUrl} from "../src/model.js";
const clear=(s,date)=>setRecord(s,date,"clear");
test("日期跨年、闰年和无效日期",()=>{
  assert.equal(shiftDate("2024-02-28",1),"2024-02-29");assert.equal(shiftDate("2024-12-31",1),"2025-01-01");
  assert.equal(dateKey(parseDate("2026-11-18")),"2026-11-18");assert.throws(()=>parseDate("2026-02-29"));assert.throws(()=>parseDate("2026-13-01"));
  const feb=calendarDays(2024,1);assert.equal(feb.days.length,29);assert.equal(feb.offset,3);
});
test("缺打卡会打断连续天数，今日未打卡可暂计至昨日",()=>{
  let s=emptyState();for(const d of ["2026-11-10","2026-11-11","2026-11-13","2026-11-14","2026-11-15"])s=clear(s,d);
  assert.equal(statistics(s,"2026-11-16").current,3);assert.equal(statistics(s,"2026-11-17").current,0);assert.equal(statistics(s,"2026-11-16").longest,3);
  s=setRecord(s,"2026-11-16","reset","2026-11-16T08:00:00Z");assert.equal(statistics(s,"2026-11-16").current,0);
  assert.equal(statistics(s,"2026-11-16").ratio,83);
});
test("月度分母只计算已打卡日期，删除后重新计算",()=>{
  let s=clear(emptyState(),"2026-11-01");s=setRecord(s,"2026-11-02","reset","2026-11-02T08:00:00Z");s=clear(s,"2026-10-31");
  assert.equal(statistics(s,"2026-11-18").ratio,50);assert.equal(statistics(s,"2026-11-18").total,3);
  s=setRecord(s,"2026-11-02",null);assert.equal(statistics(s,"2026-11-18").ratio,100);assert.equal(statistics(s,"2026-11-18").total,2);
});
test("离线修改合并收敛，删除标记不会被旧设备复活",()=>{
  const base=setRecord(emptyState(),"2026-11-01","clear",null,1),removed=setRecord(base,"2026-11-01",null,null,2);
  assert.equal(mergeStates(base,removed).records["2026-11-01"].status,null);assert.deepEqual(mergeStates(base,removed),mergeStates(removed,base));
  const one={...base.records["2026-11-01"],updatedAt:8,mutationId:"aaaaaaaa"},two={...one,status:null,mutationId:"bbbbbbbb"};
  const a={version:1,records:{[one.date]:one},recovery:null},b={version:1,records:{[two.date]:two},recovery:null};
  assert.deepEqual(mergeStates(a,b),mergeStates(b,a));assert.deepEqual(mergeStates(a,a),a);
});
test("时间进度使用最近事件，支持手动起点和 120 小时封顶",()=>{
  let s=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T00:00:00Z");s=setRecord(s,"2026-11-02","reset","2026-11-02T00:00:00Z");
  assert.equal(recoveryProgress(s,Date.parse("2026-11-03T00:00:00Z")).hours,24);assert.equal(recoveryProgress(s,Date.parse("2026-11-08T00:00:00Z")).progress,1);
  s=setRecovery(s,"2026-11-01T00:00:00Z");assert.equal(recoveryProgress(s,Date.parse("2026-11-03T00:00:00Z")).hours,48);
  s=setRecovery(s,null);assert.equal(recoveryProgress(s,Date.parse("2026-11-03T00:00:00Z")).hours,24);
});
test("备份只接受正确格式，原数据不因导入失败而改变",()=>{
  const s=clear(emptyState(),"2026-11-01");assert.throws(()=>validateState({version:1,records:{"2026-11-01":{status:"clear"}}}));
  assert.throws(()=>importBackup(s,clear(emptyState(),"2099-01-01"),"2026-11-18"));assert.equal(Object.keys(s.records).length,1);
  const imported=importBackup(s,setRecord(emptyState(),"2026-11-01",null));assert.equal(imported.records["2026-11-01"].status,null);
  assert.equal(imported.records["2026-11-01"].date,"2026-11-01");
});
test("密钥使用 192 位随机数，服务地址拒绝非 HTTPS 和 URL 凭证",()=>{
  const keys=new Set(Array.from({length:100},createSyncKey));assert.equal(keys.size,100);for(const key of keys)assert.match(key,SYNC_KEY_PATTERN);
  assert.equal(normalizeApiUrl("https://example.workers.dev/"),"https://example.workers.dev");assert.equal(normalizeApiUrl("http://localhost:8787"),"http://localhost:8787");
  for(const url of ["http://example.com","https://key:secret@example.com","https://example.com/api","https://example.com?key=secret"])assert.throws(()=>normalizeApiUrl(url));
});
