export const FORMAT_VERSION = 2;
export const SYNC_KEY_PATTERN = /^lu_[A-Za-z0-9_-]{32}$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RECORDS = 40000;

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function parseDate(key) {
  if (typeof key !== "string" || !DATE_PATTERN.test(key)) throw new Error("日期格式不正确");
  const [year,month,day] = key.split("-").map(Number);
  const value = new Date(0); value.setFullYear(year,month-1,day); value.setHours(12,0,0,0);
  if (year < 1900 || year > 2200 || dateKey(value) !== key) throw new Error("日期不存在");
  return value;
}
export function shiftDate(key, amount) { const date = parseDate(key); date.setDate(date.getDate()+amount); return dateKey(date); }
export function emptyState() { return { version:FORMAT_VERSION, records:{}, recovery:null }; }
export function validMutation(value) {
  return value && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0 && typeof value.mutationId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value.mutationId);
}
export function validateRecord(value, legacy=false) {
  if (!validMutation(value)) throw new Error("记录版本不正确");
  parseDate(value.date);
  if (!["clear","reset",null].includes(value.status)) throw new Error("打卡状态不正确");
  if (value.status === "reset" && (typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt)))) throw new Error("记录时间不正确");
  if (value.occurredAt !== null && (typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt)))) throw new Error("记录时间不正确");
  if (value.status === null && value.occurredAt !== null) throw new Error("记录时间不正确");
  const id=legacy?`day_${value.date}`:value.id;
  if(typeof id!=="string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(id) || ["__proto__","constructor","prototype"].includes(id)) throw new Error("记录标识不正确");
  return {id,date:value.date,status:value.status,occurredAt:value.occurredAt,updatedAt:value.updatedAt,mutationId:value.mutationId};
}
export function validateRecovery(value) {
  if (value === null || value === undefined) return null;
  if (!validMutation(value) || (value.start !== null && (typeof value.start !== "string" || !Number.isFinite(Date.parse(value.start))))) throw new Error("计时设置不正确");
  return {start:value.start,updatedAt:value.updatedAt,mutationId:value.mutationId};
}
export function validateState(value) {
  if (!value || ![1,FORMAT_VERSION].includes(value.version) || !value.records || typeof value.records !== "object" || Array.isArray(value.records)) throw new Error("不是有效的撸了么备份");
  const entries = Object.entries(value.records);
  if (entries.length > MAX_RECORDS) throw new Error("记录数量超出限制");
  const state=emptyState();
  for (const [key,record] of entries) { const safe=validateRecord(record,value.version===1); if(key!==(value.version===1?safe.date:safe.id)) throw new Error("记录标识不一致"); state.records[safe.id]=safe; }
  state.recovery=validateRecovery(value.recovery);
  return state;
}
function isNewer(incoming,current) {
  return !current || incoming.updatedAt > current.updatedAt || (incoming.updatedAt === current.updatedAt && incoming.mutationId > current.mutationId);
}
export function mergeStates(local, remote) {
  const merged={version:FORMAT_VERSION,records:{...local.records},recovery:local.recovery};
  for (const [date,record] of Object.entries(remote.records)) if(isNewer(record,merged.records[date])) merged.records[date]=record;
  if (remote.recovery && isNewer(remote.recovery,merged.recovery)) merged.recovery=remote.recovery;
  return merged;
}
export function nextMutation(state, now=Date.now()) {
  const newest=Object.values(state.records).reduce((max,r)=>Math.max(max,r.updatedAt),state.recovery?.updatedAt||0);
  return {updatedAt:Math.max(now,newest+1),mutationId:crypto.randomUUID()};
}
export function setRecord(state,date,status,occurredAt=null,now=Date.now()) {
  if(status!=="reset") throw new Error("只需要记录“撸了”，没撸会按日期自动统计");
  if(Object.keys(state.records).length>=MAX_RECORDS) throw new Error("记录空间已满，请先导出备份");
  return editRecord(state,crypto.randomUUID(),date,status,occurredAt,now);
}
export function editRecord(state,id,date,status,occurredAt=null,now=Date.now()) {
  if(status!=="reset"&&status!==null) throw new Error("只需要记录“撸了”，没撸会按日期自动统计");
  const record=validateRecord({id,date,status,occurredAt:status===null?null:occurredAt,...nextMutation(state,now)});
  validateRecordTime(record);
  return {...state,records:{...state.records,[id]:record}};
}
export function validateRecordTime(record,now=Date.now(),today=dateKey(new Date(now))) {
  if(record.status!=="reset")return;
  if(record.date>today)throw new Error("不能记录未来日期");
  if(Date.parse(record.occurredAt)>now)throw new Error("记录时间不能晚于现在");
}
export function deleteRecord(state,id,now=Date.now()) {
  const record=state.records[id];
  if(!record) throw new Error("记录不存在");
  return editRecord(state,id,record.date,null,null,now);
}
export function recordsForDay(state,date) {
  const now=Date.now();
  return Object.values(state.records).filter(r=>r.date===date&&r.status==="reset"&&r.date<=dateKey(new Date(now))&&Date.parse(r.occurredAt)<=now).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||b.id.localeCompare(a.id));
}
export function dailyRecords(state,today=dateKey()) {
  const days={},now=Date.now();
  for(const r of Object.values(state.records)) {
    if(r.status!=="reset"||r.date>today||Date.parse(r.occurredAt)>now)continue;
    const day=days[r.date]||={date:r.date,status:"reset",count:0,resets:0,firstOccurredAt:r.occurredAt};
    day.count++;day.resets++;
    if(Date.parse(r.occurredAt)<Date.parse(day.firstOccurredAt))day.firstOccurredAt=r.occurredAt;
  }
  return days;
}
export function setRecovery(state,start,now=Date.now()) {
  return {...state,recovery:validateRecovery({start,...nextMutation(state,now)})};
}
// 用 UTC 的日历日期求天数，避免本地夏令时把一天算成 23 或 25 小时。
function daysBetween(start,end) {return Math.round((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000);}
function monthCoverage(firstDate,today,month) {
  if(!firstDate)return 0;
  const date=parseDate(`${month}-01`);date.setMonth(date.getMonth()+1);date.setDate(0);
  const start=firstDate>`${month}-01`?firstDate:`${month}-01`,end=today<dateKey(date)?today:dateKey(date);
  return start<=end?daysBetween(start,end)+1:0;
}
export function statistics(state,today=dateKey(),month=today.slice(0,7)) {
  const records=Object.values(dailyRecords(state,today)).sort((a,b)=>a.date.localeCompare(b.date));
  const first=records[0],last=records.at(-1),total=records.reduce((sum,r)=>sum+r.resets,0);
  const current=last?daysBetween(last.date,today):0;
  let longest=current;
  for(let i=1;i<records.length;i++)longest=Math.max(longest,daysBetween(records[i-1].date,records[i].date)-1);
  const monthly=records.filter(r=>r.date.startsWith(month)),monthTotal=monthCoverage(first?.date,today,month),clear=monthTotal-monthly.length;
  return {firstDate:first?.date||null,firstOccurredAt:first?.firstOccurredAt||null,total,totalDays:first?daysBetween(first.date,today)+1:0,eventDays:records.length,resetCount:total,longest,current,monthClear:clear,monthReset:monthly.length,monthResetCount:monthly.reduce((sum,r)=>sum+r.resets,0),monthTotal,ratio:monthTotal?Math.round(clear/monthTotal*100):null};
}
export function chartStatistics(state,today=dateKey(),range=30) {
  const days=dailyRecords(state,today),start=shiftDate(today,1-range),firstDate=Object.keys(days).sort()[0]||null,now=Date.now();
  const events=Object.values(state.records).filter(r=>r.status==="reset"&&r.date>=start&&r.date<=today&&Date.parse(r.occurredAt)<=now);
  const daily=Array.from({length:range},(_,i)=>{const date=shiftDate(start,i),day=days[date];return {date,count:day?.resets||0,tracked:Boolean(firstDate&&date>=firstDate)};});
  const weekdays=Array(7).fill(0),periods=Array(4).fill(0);let unknownTimes=0;
  for(const r of events) {
    weekdays[(parseDate(r.date).getDay()+6)%7]++;
    if(r.occurredAt)periods[Math.floor(new Date(r.occurredAt).getHours()/6)]++;else unknownTimes++;
  }
  const months=Array.from({length:6},(_,i)=>{const date=parseDate(today);date.setDate(1);date.setMonth(date.getMonth()-5+i);const key=dateKey(date).slice(0,7);return {month:key,count:0,days:monthCoverage(firstDate,today,key)};});
  for(const day of Object.values(days)) {const month=months.find(m=>m.month===day.date.slice(0,7));if(month)month.count+=day.resets;}
  return {daily,weekdays,periods,unknownTimes,months,firstDate,total:events.length,trackedDays:daily.filter(d=>d.tracked).length};
}
export function calendarDays(year,month) {
  const first=new Date(year,month,1,12);
  const count=new Date(year,month+1,0,12).getDate();
  return {offset:(first.getDay()+6)%7,days:Array.from({length:count},(_,i)=>dateKey(new Date(year,month,i+1,12)))};
}
export function recoveryProgress(state, now=Date.now()) {
  const latest=Object.values(state.records).filter(r=>r.status==="reset"&&Date.parse(r.occurredAt)<=now).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
  const override=state.recovery?.start;
  // 新记录发生在手动起点之后时，自动从新记录重新计时。
  const manual=Boolean(override&&(!latest||state.recovery.updatedAt>=latest.updatedAt||Date.parse(override)>Date.parse(latest.occurredAt)));
  const start=manual?override:latest?.occurredAt||null;
  if(!start) return {start:null,hours:0,progress:0,manual:false,stage:0,nextHours:24};
  const hours=Math.max(0,(now-Date.parse(start))/3600000);
  const marks=[0,24,48,72,120],stage=marks.reduce((active,mark,i)=>hours>=mark?i:active,0);
  return {start,hours,progress:Math.min(1,hours/120),manual,stage,nextHours:stage<4?marks[stage+1]-hours:0};
}
export function importBackup(current,input,today=dateKey()) {
  const imported=validateState(input);
  let result=current;
  for(const r of Object.values(imported.records).sort((a,b)=>a.date.localeCompare(b.date))) {
    if(r.date>today) throw new Error("备份包含未来日期，请检查设备日期或备份内容");
    validateRecordTime(r,Date.now(),today);
    // 保留旧“没撸”数据用于备份和旧设备兼容；新版展示和统计只读取“撸了”。
    if(r.status==="clear")result={...result,records:{...result.records,[r.id]:{...r,...nextMutation(result)}}};
    else result=editRecord(result,r.id,r.date,r.status,r.occurredAt);
  }
  if(imported.recovery) {
    if(imported.recovery.start&&Date.parse(imported.recovery.start)>Date.now()) throw new Error("备份包含未来的计时起点");
    result=setRecovery(result,imported.recovery.start);
  }
  return validateState(result);
}
export function createSyncKey() {
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  return "lu_"+btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_");
}
export function normalizeApiUrl(input) {
  const url=new URL(input);
  const local=["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if ((url.protocol!=="https:" && !(local&&url.protocol==="http:")) || url.username || url.password || url.search || url.hash) throw new Error("请使用 HTTPS 服务地址；本机调试可使用 HTTP");
  if(url.pathname!=="/"&&url.pathname!=="") throw new Error("请填写 Worker 根地址，不含 /api 等路径");
  return url.origin;
}
