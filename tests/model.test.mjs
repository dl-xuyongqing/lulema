import test from "node:test";
import assert from "node:assert/strict";
import {dateKey,parseDate,shiftDate,emptyState,setRecord,editRecord,deleteRecord,recordsForDay,chartStatistics,setRecovery,statistics,calendarDays,recoveryProgress,mergeStates,validateState,importBackup,createSyncKey,SYNC_KEY_PATTERN,normalizeApiUrl} from "../src/model.js";
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
  s=deleteRecord(s,recordsForDay(s,"2026-11-02")[0].id);assert.equal(statistics(s,"2026-11-18").ratio,100);assert.equal(statistics(s,"2026-11-18").total,2);
});
test("离线修改合并收敛，删除标记不会被旧设备复活",()=>{
  const base=setRecord(emptyState(),"2026-11-01","clear",null,1),id=Object.keys(base.records)[0],removed=deleteRecord(base,id,2);
  assert.equal(mergeStates(base,removed).records[id].status,null);assert.deepEqual(mergeStates(base,removed),mergeStates(removed,base));
  const one={...base.records[id],updatedAt:8,mutationId:"aaaaaaaa"},two={...one,status:null,mutationId:"bbbbbbbb"};
  const a={version:2,records:{[one.id]:one},recovery:null},b={version:2,records:{[two.id]:two},recovery:null};
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
  const id=Object.keys(s.records)[0],imported=importBackup(s,deleteRecord(s,id));assert.equal(imported.records[id].status,null);
  assert.equal(imported.records[id].date,"2026-11-01");
});
test("同一天可反复添加，按天计算状态、按条计算次数，单条修改删除",()=>{
  let s=clear(emptyState(),"2026-11-01");
  for(let i=0;i<12;i++)s=setRecord(s,"2026-11-01","reset",`2026-11-01T${String(i).padStart(2,"0")}:00:00Z`);
  s=clear(s,"2026-11-01");
  assert.equal(recordsForDay(s,"2026-11-01").length,14);
  const stats=statistics(s,"2026-11-01");assert.equal(stats.total,14);assert.equal(stats.totalDays,1);assert.equal(stats.resetCount,12);assert.equal(stats.current,0);assert.equal(stats.ratio,0);
  const id=recordsForDay(s,"2026-11-01").find(r=>r.status==="reset").id;
  s=editRecord(s,id,"2026-11-01","clear","2026-11-01T13:00:00Z");assert.equal(statistics(s,"2026-11-01").resetCount,11);assert.equal(statistics(s,"2026-11-01").total,14);
  s=deleteRecord(s,id);assert.equal(statistics(s,"2026-11-01").total,13);assert.equal(recordsForDay(s,"2026-11-01").length,13);
});
test("同一天不同设备的新增不会相互覆盖",()=>{
  const a=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T10:00:00Z",1),b=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T11:00:00Z",1);
  const merged=mergeStates(a,b);assert.equal(recordsForDay(merged,"2026-11-01").length,2);assert.deepEqual(merged,mergeStates(b,a));
  const id=Object.keys(a.records)[0],removed=deleteRecord(merged,id,3);assert.equal(recordsForDay(mergeStates(removed,a),"2026-11-01").length,1);
});
test("旧备份稳定迁移，重复导入不增加条数，旧删除标记仍有效",()=>{
  const legacy={version:1,records:{"2026-11-01":{date:"2026-11-01",status:"clear",occurredAt:null,updatedAt:1,mutationId:"legacy_01"}},recovery:null};
  const migrated=validateState(legacy);assert.equal(migrated.version,2);assert.equal(migrated.records["day_2026-11-01"].status,"clear");
  let s=importBackup(emptyState(),legacy,"2026-11-18");s=importBackup(s,legacy,"2026-11-18");assert.equal(Object.keys(s.records).length,1);
  s=deleteRecord(s,"day_2026-11-01");assert.equal(mergeStates(s,migrated).records["day_2026-11-01"].status,null);
  assert.throws(()=>validateState({...s,records:{wrong_id:migrated.records["day_2026-11-01"]}}),/标识/);
});
test("图表按范围汇总次数，区分未记录，正确处理星期、时段和跨年月",()=>{
  let s=clear(emptyState(),"2026-01-02");
  const at=new Date(2026,0,3,13).toISOString();
  for(let i=0;i<3;i++)s=setRecord(s,"2026-01-03","reset",at);
  s=setRecord(s,"2025-12-31","reset",new Date(2025,11,31,3).toISOString());
  const c=chartStatistics(s,"2026-01-04",7);assert.equal(c.total,4);assert.equal(c.recordedDays,3);assert.equal(c.daily.at(-1).recorded,false);assert.equal(c.daily.find(d=>d.date==="2026-01-02").recorded,true);
  assert.equal(c.weekdays[5],3);assert.deepEqual(c.periods,[1,0,3,0]);assert.equal(c.months.at(-1).count,3);assert.equal(c.months.at(-2).count,1);
  assert.equal(chartStatistics(s,"2026-01-04",3).total,3);
});
test("新的一次记录重新开始计时，删除最新记录后跟随上一条",()=>{
  let s=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T00:00:00Z",1);s=setRecovery(s,"2026-11-01T01:00:00Z",2);
  s=setRecord(s,"2026-11-01","reset","2026-11-01T02:00:00Z",3);
  assert.equal(recoveryProgress(s,Date.parse("2026-11-02T02:00:00Z")).hours,24);assert.equal(recoveryProgress(s,Date.parse("2026-11-02T02:00:00Z")).stage,1);
  const latest=recordsForDay(s,"2026-11-01")[0];s=deleteRecord(s,latest.id,4);assert.equal(recoveryProgress(s,Date.parse("2026-11-02T02:00:00Z")).hours,25);
});
test("密钥使用 192 位随机数，服务地址拒绝非 HTTPS 和 URL 凭证",()=>{
  const keys=new Set(Array.from({length:100},createSyncKey));assert.equal(keys.size,100);for(const key of keys)assert.match(key,SYNC_KEY_PATTERN);
  assert.equal(normalizeApiUrl("https://example.workers.dev/"),"https://example.workers.dev");assert.equal(normalizeApiUrl("http://localhost:8787"),"http://localhost:8787");
  for(const url of ["http://example.com","https://key:secret@example.com","https://example.com/api","https://example.com?key=secret"])assert.throws(()=>normalizeApiUrl(url));
});
