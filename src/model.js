export const FORMAT_VERSION = 1;
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
export function validateRecord(value) {
  if (!validMutation(value)) throw new Error("记录版本不正确");
  parseDate(value.date);
  if (!["clear","reset",null].includes(value.status)) throw new Error("打卡状态不正确");
  if (value.status === "reset" && (typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt)))) throw new Error("记录时间不正确");
  if (value.status !== "reset" && value.occurredAt !== null) throw new Error("记录时间不正确");
  return {date:value.date,status:value.status,occurredAt:value.occurredAt,updatedAt:value.updatedAt,mutationId:value.mutationId};
}
export function validateRecovery(value) {
  if (value === null || value === undefined) return null;
  if (!validMutation(value) || (value.start !== null && (typeof value.start !== "string" || !Number.isFinite(Date.parse(value.start))))) throw new Error("计时设置不正确");
  return {start:value.start,updatedAt:value.updatedAt,mutationId:value.mutationId};
}
export function validateState(value) {
  if (!value || value.version !== FORMAT_VERSION || !value.records || typeof value.records !== "object" || Array.isArray(value.records)) throw new Error("不是有效的撸了么备份");
  const entries = Object.entries(value.records);
  if (entries.length > MAX_RECORDS) throw new Error("记录数量超出限制");
  const state=emptyState();
  for (const [key,record] of entries) { const safe=validateRecord(record); if(key!==safe.date) throw new Error("记录日期不一致"); state.records[key]=safe; }
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
  const newest=Math.max(0,state.recovery?.updatedAt||0,...Object.values(state.records).map(r=>r.updatedAt));
  return {updatedAt:Math.max(now,newest+1),mutationId:crypto.randomUUID()};
}
export function setRecord(state,date,status,occurredAt=null,now=Date.now()) {
  parseDate(date);
  const record=validateRecord({date,status,occurredAt:status==="reset"?occurredAt:null,...nextMutation(state,now)});
  return {...state,records:{...state.records,[date]:record}};
}
export function setRecovery(state,start,now=Date.now()) {
  return {...state,recovery:validateRecovery({start,...nextMutation(state,now)})};
}
export function statistics(state,today=dateKey(),month=today.slice(0,7)) {
  const records=Object.values(state.records).filter(r=>r.status!==null&&r.date<=today).sort((a,b)=>a.date.localeCompare(b.date));
  let longest=0,run=0,previous=null;
  for (const record of records) {
    if (record.status==="clear") {run=previous&&shiftDate(previous,1)===record.date?run+1:1;longest=Math.max(longest,run);} else run=0;
    previous=record.date;
  }
  let cursor=state.records[today]?.status?today:shiftDate(today,-1),current=0;
  while(state.records[cursor]?.status==="clear") {current++;cursor=shiftDate(cursor,-1);}
  const monthly=records.filter(r=>r.date.startsWith(month));
  const clear=monthly.filter(r=>r.status==="clear").length;
  return {total:records.length,longest,current,monthClear:clear,monthReset:monthly.length-clear,monthTotal:monthly.length,ratio:monthly.length?Math.round(clear/monthly.length*100):null};
}
export function calendarDays(year,month) {
  const first=new Date(year,month,1,12);
  const count=new Date(year,month+1,0,12).getDate();
  return {offset:(first.getDay()+6)%7,days:Array.from({length:count},(_,i)=>dateKey(new Date(year,month,i+1,12)))};
}
export function recoveryProgress(state, now=Date.now()) {
  const latest=Object.values(state.records).filter(r=>r.status==="reset"&&Date.parse(r.occurredAt)<=now).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
  const override=state.recovery?.start;
  const start=override||latest?.occurredAt||null;
  if(!start) return {start:null,hours:0,progress:0,manual:false};
  const hours=Math.max(0,(now-Date.parse(start))/3600000);
  return {start,hours,progress:Math.min(1,hours/120),manual:Boolean(override)};
}
export function importBackup(current,input,today=dateKey()) {
  const imported=validateState(input);
  let result=current;
  for(const r of Object.values(imported.records).sort((a,b)=>a.date.localeCompare(b.date))) {
    if(r.date>today) throw new Error("备份包含未来日期，请检查设备日期或备份内容");
    if(r.status==="reset"&&Date.parse(r.occurredAt)>Date.now()) throw new Error("备份包含未来的记录时间");
    result=setRecord(result,r.date,r.status,r.occurredAt);
  }
  if(imported.recovery) {
    if(imported.recovery.start&&Date.parse(imported.recovery.start)>Date.now()) throw new Error("备份包含未来的计时起点");
    result=setRecovery(result,imported.recovery.start);
  }
  return result;
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
