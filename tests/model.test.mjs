import test from "node:test";
import assert from "node:assert/strict";
import {dateKey,parseDate,shiftDate,emptyState,setRecord,editRecord,deleteRecord,recordsForDay,chartStatistics,setRecovery,statistics,calendarDays,recoveryProgress,mergeStates,validateState,importBackup,createSyncKey,SYNC_KEY_PATTERN,normalizeApiUrl} from "../src/model.js";
const reset=(s,date)=>setRecord(s,date,"reset",`${date}T08:00:00Z`);
test("日期跨年、闰年和无效日期",()=>{
  assert.equal(shiftDate("2024-02-28",1),"2024-02-29");assert.equal(shiftDate("2024-12-31",1),"2025-01-01");
  assert.equal(dateKey(parseDate("2026-11-18")),"2026-11-18");assert.throws(()=>parseDate("2026-02-29"));assert.throws(()=>parseDate("2026-13-01"));
  const feb=calendarDays(2024,1);assert.equal(feb.days.length,29);assert.equal(feb.offset,3);
});
test("从首次撸了到今天统计，空白日期自动计作没撸",()=>{
  let s=emptyState();for(const d of ["2026-11-10","2026-11-13","2026-11-13","2026-11-15"])s=reset(s,d);
  const stats=statistics(s,"2026-11-18");
  assert.equal(stats.firstDate,"2026-11-10");assert.equal(stats.totalDays,9);assert.equal(stats.eventDays,3);assert.equal(stats.total,4);
  assert.equal(stats.current,3);assert.equal(stats.longest,3);assert.equal(stats.ratio,67);
  assert.equal(statistics(s,"2026-11-12").current,2);assert.equal(statistics(s,"2026-11-12").totalDays,3);
  s=deleteRecord(s,recordsForDay(s,"2026-11-15")[0].id);assert.equal(statistics(s,"2026-11-18").current,5);
});
test("月度分母按统计起点和今天截取，删除后重算",()=>{
  let s=reset(emptyState(),"2026-10-31");s=reset(s,"2026-11-02");
  const stats=statistics(s,"2026-11-18");assert.equal(stats.monthTotal,18);assert.equal(stats.monthClear,17);assert.equal(stats.ratio,94);assert.equal(stats.totalDays,19);
  assert.equal(statistics(s,"2026-11-18","2026-09").ratio,null);
  s=deleteRecord(s,recordsForDay(s,"2026-11-02")[0].id);assert.equal(statistics(s,"2026-11-18").ratio,100);assert.equal(statistics(s,"2026-11-18").total,1);
  assert.equal(statistics(reset(emptyState(),"2026-11-10"),"2026-11-18").monthTotal,9);
});
test("离线修改合并收敛，删除标记不会被旧设备复活",()=>{
  const base=setRecord(emptyState(),"2026-11-01","reset","2026-11-01T08:00:00Z",1),id=Object.keys(base.records)[0],removed=deleteRecord(base,id,2);
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
  const s=reset(emptyState(),"2026-11-01");assert.throws(()=>validateState({version:1,records:{"2026-11-01":{status:"clear"}}}));
  const id=Object.keys(s.records)[0],future={...s,records:{[id]:{...s.records[id],date:"2099-01-01",occurredAt:"2099-01-01T08:00:00Z"}}};
  assert.throws(()=>importBackup(s,future,"2026-11-18"),/未来日期/);assert.equal(Object.keys(s.records).length,1);
  const imported=importBackup(s,deleteRecord(s,id));assert.equal(imported.records[id].status,null);
  assert.equal(imported.records[id].date,"2026-11-01");
});
test("同一天可反复添加，按天计算状态、按条计算次数，单条修改删除",()=>{
  let s=emptyState();
  for(let i=0;i<12;i++)s=setRecord(s,"2026-11-01","reset",`2026-11-01T${String(i).padStart(2,"0")}:00:00Z`);
  assert.equal(recordsForDay(s,"2026-11-01").length,12);
  const stats=statistics(s,"2026-11-01");assert.equal(stats.total,12);assert.equal(stats.totalDays,1);assert.equal(stats.resetCount,12);assert.equal(stats.current,0);assert.equal(stats.ratio,0);
  const id=recordsForDay(s,"2026-11-01").find(r=>r.status==="reset").id;
  s=editRecord(s,id,"2026-11-01","reset","2026-11-01T13:00:00Z");assert.equal(statistics(s,"2026-11-01").resetCount,12);assert.equal(s.records[id].occurredAt,"2026-11-01T13:00:00Z");
  s=deleteRecord(s,id);assert.equal(statistics(s,"2026-11-01").total,11);assert.equal(recordsForDay(s,"2026-11-01").length,11);
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
  assert.equal(recordsForDay(s,"2026-11-01").length,0);assert.equal(statistics(s,"2026-11-18").firstDate,null);
  assert.equal(statistics(reset(s,"2026-11-10"),"2026-11-18").firstDate,"2026-11-10");
  s=deleteRecord(s,"day_2026-11-01");assert.equal(mergeStates(s,migrated).records["day_2026-11-01"].status,null);
  assert.throws(()=>validateState({...s,records:{wrong_id:migrated.records["day_2026-11-01"]}}),/标识/);
});
test("图表在统计范围内补零，范围之前留空，正确汇总星期时段和跨年月",()=>{
  let s=emptyState();
  const at=new Date(2026,0,3,13).toISOString();
  for(let i=0;i<3;i++)s=setRecord(s,"2026-01-03","reset",at);
  s=setRecord(s,"2025-12-31","reset",new Date(2025,11,31,3).toISOString());
  const c=chartStatistics(s,"2026-01-04",7);assert.equal(c.total,4);assert.equal(c.trackedDays,5);assert.equal(c.daily.at(-1).tracked,true);assert.equal(c.daily[0].tracked,false);assert.equal(c.daily.find(d=>d.date==="2026-01-02").count,0);
  assert.equal(c.weekdays[5],3);assert.deepEqual(c.periods,[1,0,3,0]);assert.equal(c.months.at(-1).count,3);assert.equal(c.months.at(-2).count,1);
  assert.equal(c.months.at(-1).days,4);assert.equal(c.months.at(-2).days,1);
  assert.equal(chartStatistics(s,"2026-01-04",3).total,3);
});
test("无首次记录时不统计，删除首次记录会移动起点，删除全部恢复空状态",()=>{
  assert.equal(statistics(emptyState(),"2026-11-18").ratio,null);assert.equal(chartStatistics(emptyState(),"2026-11-18").trackedDays,0);
  let s=reset(emptyState(),"2026-11-01");s=reset(s,"2026-11-10");
  s=deleteRecord(s,recordsForDay(s,"2026-11-01")[0].id);assert.equal(statistics(s,"2026-11-18").firstDate,"2026-11-10");
  s=deleteRecord(s,recordsForDay(s,"2026-11-10")[0].id);assert.equal(statistics(s,"2026-11-18").totalDays,0);assert.equal(statistics(s,"2026-11-18").current,0);
});
test("跨年和闰年空白日期按日历天数统计，空白月份也纳入",()=>{
  const s=reset(emptyState(),"2023-12-31"),stats=statistics(s,"2024-03-01","2024-02");
  assert.equal(stats.totalDays,62);assert.equal(stats.current,61);assert.equal(stats.monthTotal,29);assert.equal(stats.ratio,100);
  const c=chartStatistics(s,"2024-03-01");assert.equal(c.months.find(m=>m.month==="2024-02").days,29);assert.equal(c.months.find(m=>m.month==="2024-02").count,0);
});
test("新增、修改和导入拒绝未来时间，也不能手动记录没撸",()=>{
  const date=dateKey(),future=new Date(Date.now()+60000).toISOString(),past=new Date(Date.now()-60000).toISOString();
  assert.throws(()=>setRecord(emptyState(),date,"reset",future),/晚于现在/);
  assert.throws(()=>setRecord(emptyState(),shiftDate(date,1),"reset",past),/未来日期/);
  assert.throws(()=>setRecord(emptyState(),date,"clear"),/只需要记录/);
  const s=setRecord(emptyState(),date,"reset",past),id=Object.keys(s.records)[0];
  assert.throws(()=>editRecord(s,id,date,"reset",future),/晚于现在/);
  assert.throws(()=>importBackup(s,{...s,records:{[id]:{...s.records[id],occurredAt:future}}}),/晚于现在/);
  const invalid=validateState({...s,records:{[id]:{...s.records[id],occurredAt:future}}});assert.equal(statistics(invalid).firstDate,null);
  assert.equal(s.records[id].occurredAt,past);
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
