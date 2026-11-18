import {dateKey,parseDate,emptyState,setRecord,editRecord,deleteRecord,recordsForDay,dailyRecords,setRecovery,statistics,calendarDays,recoveryProgress,importBackup,createSyncKey,mergeStates,validateState} from "./model.js";
import {renderCharts} from "./charts.js";
import {loadState,saveState,loadCloud,saveCloud,STATE_KEY} from "./storage.js";
import {validateConnection,synchronize} from "./cloud.js";

const $=selector=>document.querySelector(selector);
let state=emptyState(),connection=null,storageBlocked=false;
try {state=loadState();} catch {storageBlocked=true;}
try {const saved=loadCloud();if(saved)connection=validateConnection(saved);} catch {connection=null;}
let today=dateKey(),viewDate=parseDate(today),editingDate=today,editingId=null,chartRange=30,chartDimension="daily",chartType="line";
let syncRunning=false,syncAgain=false,syncTimer=null,toastTimer=null,lastSync=null,lastError="";
const formatMonth=new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long"});
const formatFull=new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"});
const formatShort=new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
function toast(message,error=false) {const el=$("#toast");el.textContent=message;el.classList.toggle("error",error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?6500:3300);}
function commit(next,{quiet=false}={}) {
  if(storageBlocked) {toast("本机记录暂时无法读取。请先保留浏览器中的原始数据并检查存储权限。",true);return false;}
  try {saveState(next);state=next;} catch {toast("浏览器未能保存记录，请检查存储空间或权限；这次修改未保存。",true);return false;}
  render();if(!quiet)scheduleSync();return true;
}
function render() {
  const summary=statistics(state,today);
  $("#current-date").textContent=formatFull.format(parseDate(today));
  $("#current-streak").textContent=summary.current;
  $("#total-days").textContent=summary.totalDays;
  $("#total-days-note").textContent=summary.firstDate?`从 ${summary.firstDate} 起`:"首次记录后开始";
  $("#reset-count").textContent=summary.resetCount;
  $("#longest-streak").textContent=summary.longest;
  $("#month-ratio").textContent=summary.ratio===null?"—":summary.ratio;
  $("#ratio-unit").textContent=summary.ratio===null?"":" %";
  $("#ratio-note").textContent=summary.monthTotal?`本月纳入 ${summary.monthTotal} 天`:"首次记录后开始统计";
  $("#tracking-period").textContent=summary.firstOccurredAt?`统计从 ${formatShort.format(new Date(summary.firstOccurredAt))} 到现在，今天按当前记录计算。`:"记录第一次“撸了”后开始统计，之前的日期不计入。";
  const entries=recordsForDay(state,today),status=entries.length?"reset":summary.firstDate?"clear":"";
  $("#streak-description").textContent=summary.current?"一点一滴，都是属于你的进步。":"从今天开始，找到自己的节奏。";
  $("#streak-note").textContent=summary.firstDate?"没有记录的日期，自动计作没撸":"首次记录后开始计算";
  $("#today-badge").textContent=entries.length?`今天 ${entries.length} 次`:summary.firstDate?"今天没撸":"尚未开始";
  $("#today-badge").className=`badge ${status||""}`;
  $("#today-message").textContent=entries.length?`今天已记录 ${entries.length} 次“撸了”，可以继续添加。`:summary.firstDate?"今天截至现在没有记录，自动算作没撸。":"点击记录一次，开始统计自己的节奏。";
  const preview=$("#today-records");preview.replaceChildren();
  for(const record of entries.slice(0,3)) {const button=document.createElement("button");button.className="today-record reset";button.dataset.editRecord=record.id;button.textContent=`${new Date(record.occurredAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false})} · 撸了`;preview.append(button);}
  renderCalendar();renderRecovery();renderStatistics();renderCloud();
}
function renderStatistics() {renderCharts(state,today,chartRange,chartDimension,chartType);}
function renderCalendar() {
  const year=viewDate.getFullYear(),month=viewDate.getMonth();
  const monthKey=`${year}-${String(month+1).padStart(2,"0")}`;
  const summary=statistics(state,today,monthKey);
  $("#calendar-month").textContent=formatMonth.format(viewDate);
  $("#month-clear").textContent=summary.monthClear;$("#month-reset").textContent=summary.monthReset;
  $("#next-month").disabled=monthKey>=today.slice(0,7);
  $("#previous-month").disabled=year<=1900&&month===0;
  $("#back-current-month").hidden=monthKey===today.slice(0,7);
  const {offset,days}=calendarDays(year,month),grid=$("#calendar-grid"),daily=dailyRecords(state,today);
  grid.replaceChildren();
  for(let i=0;i<offset;i++){const blank=document.createElement("div");blank.className="calendar-blank";grid.append(blank);}
  for(const date of days) {
    const day=daily[date],tracked=summary.firstDate&&date>=summary.firstDate&&date<=today,status=tracked?(day?"reset":"clear"):"",button=document.createElement("button");
    button.className=`calendar-day ${status||""}${date===today?" today":""}`;
    button.textContent=Number(date.slice(-2));button.dataset.date=date;button.disabled=date>today;
    if(day){const count=document.createElement("small");count.className="day-count";count.textContent=`${day.resets}次`;button.append(count);}
    button.setAttribute("aria-label",`${date}${date===today?"，今天":""}，${day?`撸了${day.resets}次`:tracked?"没撸，0次":date>today?"未来日期":"未纳入统计"}`);
    if(date===today)button.setAttribute("aria-current","date");
    grid.append(button);
  }
}
function renderRecovery() {
  const info=recoveryProgress(state);
  $("#time-ring").style.setProperty("--progress",`${info.progress*360}deg`);
  const hours=Math.floor(info.hours);
  const minutes=Math.floor(info.hours*60)%60;
  $("#energy-percent").textContent=info.start?`${Math.floor(info.progress*100)}%`:"—";
  $("#energy-fill").style.height=`${info.progress*100}%`;
  $("#elapsed-value").textContent=info.start?(hours>=24?`${Math.floor(hours/24)}天 ${hours%24}小时`:`${hours}小时 ${minutes}分钟`):"—";
  $("#elapsed-unit").textContent=info.start?"距离上次记录":"等待一条记录";
  $("#recovery-caption").textContent=info.start?`${info.manual?"手动起点":"上次记录"} · ${formatShort.format(new Date(info.start))}`:"记录一次“撸了”后，这里会开始计时。";
  const stages=["刚刚启程","一天小憩","两日积累","三日从容","五日里程碑"];
  $("#energy-stage").textContent=info.start?stages[info.stage]:"等待启程";
  $("#energy-next").textContent=!info.start?"记录后自动开始":info.nextHours?`下一节点还需 ${Math.ceil(info.nextHours)} 小时`:"已走过 120 小时";
  document.querySelectorAll("[data-milestone]").forEach(el=>{el.classList.toggle("reached",Boolean(info.start)&&info.hours>=Number(el.dataset.milestone));el.classList.toggle("current",Boolean(info.start)&&Number(el.dataset.milestone)===[0,24,48,72,120][info.stage]);});
  const svg=$("#recovery-chart"),points=Array.from({length:6},(_,i)=>`${10+i*52},${70-i*12}`).join(" ");
  const x=10+info.progress*260,y=70-info.progress*60;
  svg.innerHTML=`<title>0 至 120 小时的计时进度，当前 ${Math.floor(info.progress*100)}%</title><path d="M10 70H270" stroke="#e3ebd7"/><polyline points="${points}" stroke="#a0b68b" stroke-width="2"/>${info.start?`<circle cx="${x}" cy="${y}" r="4" fill="#6d8d55" stroke="white" stroke-width="2"/>`:""}`;
}
function renderCloud() {
  const badge=$("#sync-status"),label=$("#sync-label"),detail=$("#cloud-detail");
  badge.classList.toggle("syncing",syncRunning);badge.classList.toggle("error",Boolean(lastError)||storageBlocked);
  detail.classList.toggle("error",Boolean(lastError)||storageBlocked);
  label.textContent=storageBlocked?"存储异常":syncRunning?"正在同步":lastError?"等待同步":connection?(navigator.onLine?"云端已连接":"离线保存"):"本地保存";
  detail.textContent=storageBlocked?"无法读取本机存储。原始数据未被覆盖，请检查浏览器权限后重新打开。":lastError?`${lastError}。本机记录仍然保留。`:syncRunning?"正在合并本机与云端记录…":connection?(lastSync?`已同步 · ${new Date(lastSync).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`:"云端已连接，正在准备同步。"):"尚未连接云端，记录已保存在当前浏览器。";
  $("#cloud-connected").hidden=!connection;$("#sync-now").disabled=syncRunning;$("#connect-cloud").disabled=syncRunning;
}
function showDialog(selector) {const dialog=$(selector);if(!dialog.open)dialog.showModal();}
function openDay(date,id=null) {
  if(date>dateKey()){toast("不能记录未来日期。",true);return;}
  editingDate=date;editingId=id;
  const record=id?state.records[id]:null;$("#day-dialog-title").textContent=`${Number(date.slice(5,7))}月${Number(date.slice(8))}日的记录`;
  const list=$("#day-records"),entries=recordsForDay(state,date);list.replaceChildren();
  const firstDate=statistics(state,today).firstDate;
  $("#day-list-summary").textContent=entries.length?`当天撸了 ${entries.length} 次`:firstDate&&date>=firstDate?"当天没有记录，自动算作没撸。":"该日期未纳入统计，补记后会更新统计起点。";
  for(const entry of entries) {
    const row=document.createElement("div");row.className=`record-row ${entry.status}${entry.id===id?" editing":""}`;
    const label=document.createElement("span");label.textContent=`撸了 · ${new Date(entry.occurredAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false})}`;
    const actions=document.createElement("div"),edit=document.createElement("button"),remove=document.createElement("button");
    edit.type=remove.type="button";edit.className="text-button";remove.className="text-button danger";
    edit.dataset.editRecord=entry.id;remove.dataset.deleteRecord=entry.id;edit.textContent="修改";remove.textContent="删除";
    edit.setAttribute("aria-label",`修改${label.textContent}`);remove.setAttribute("aria-label",`删除${label.textContent}`);
    actions.append(edit,remove);row.append(label,actions);list.append(row);
  }
  $("#record-editor-title").textContent=id?"修改这条记录":"添加一条记录";
  $("#cancel-record-edit").hidden=!id;
  $("#day-form").reset();
  const at=record?.occurredAt?new Date(record.occurredAt):date===today?new Date():new Date(`${date}T12:00:00`);
  $("#day-time").value=`${String(at.getHours()).padStart(2,"0")}:${String(at.getMinutes()).padStart(2,"0")}`;
  updateDayTimeLimit();
  $("#day-time-field").hidden=false;
  $("#delete-day").hidden=!record?.status;
  showDialog("#day-dialog");
}
function updateDayTimeLimit() {const now=new Date();$("#day-time").max=editingDate===dateKey(now)?`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`:"23:59";}
function localDateTime(date) {return `${dateKey(date)}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;}
function openRecovery() {$("#recovery-start").value=localDateTime(new Date(recoveryProgress(state).start||Date.now()));$("#recovery-start").max=localDateTime(new Date());showDialog("#recovery-dialog");}
function openSettings() {$("#api-url").value=connection?.apiUrl||"";$("#sync-key").value=connection?.key||"";$("#sync-key").type="password";$("#toggle-key").textContent="显示";renderCloud();showDialog("#settings-dialog");}
function scheduleSync(delay=700) {if(!connection)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),delay);}
async function syncNow({feedback=false}={}) {
  if(!connection||storageBlocked)return false;
  if(syncRunning){syncAgain=true;return false;}
  if(!navigator.onLine){lastError="当前离线，联网后会自动同步";renderCloud();if(feedback)toast(lastError,true);return false;}
  const active=connection,snapshot=state;
  syncRunning=true;lastError="";renderCloud();
  try {
    const remote=await synchronize(active,snapshot);
    if(connection!==active)return false;
    const merged=mergeStates(state,remote);
    if(!commit(merged,{quiet:true})) throw new Error("云端已连接，但无法保存本机副本");
    lastSync=Date.now();lastError="";
    if(feedback)toast("云端与本机记录已同步");
    if(Object.keys(merged.records).length!==Object.keys(remote.records).length||Object.entries(merged.records).some(([date,r])=>r.mutationId!==remote.records[date]?.mutationId)||merged.recovery?.mutationId!==remote.recovery?.mutationId)syncAgain=true;
    return true;
  } catch(error) {if(connection===active){lastError=error.message;if(feedback)toast(lastError,true);}return false;}
  finally {syncRunning=false;renderCloud();if(syncAgain){syncAgain=false;scheduleSync(300);}}
}
document.addEventListener("click",event=>{
  const closer=event.target.closest("[data-close]");if(closer){closer.closest("dialog").close();return;}
  const edit=event.target.closest("[data-edit-record]");if(edit){const record=state.records[edit.dataset.editRecord];if(record)openDay(record.date,record.id);return;}
  const remove=event.target.closest("[data-delete-record]");if(remove){if(commit(deleteRecord(state,remove.dataset.deleteRecord))){openDay(editingDate);toast("已删除这条记录。");}return;}
  const button=event.target.closest("[data-action]");if(!button)return;
  if(button.dataset.action==="settings")openSettings();
  if(button.dataset.action==="edit-today")openDay(today);
  if(button.dataset.action==="recovery")openRecovery();
});
document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
document.querySelectorAll(".checkin-button").forEach(button=>button.addEventListener("click",()=>{
  tick();const now=new Date();
  try{if(commit(setRecord(state,dateKey(now),"reset",now.toISOString())))toast(`新增一条“撸了”记录，今天共 ${recordsForDay(state,today).length} 次。`);}catch(error){toast(error.message,true);}
}));
$("#calendar-grid").addEventListener("click",event=>{const button=event.target.closest("[data-date]");if(button&&!button.disabled)openDay(button.dataset.date);});
$("#previous-month").addEventListener("click",()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1,12);renderCalendar();});
$("#next-month").addEventListener("click",()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1,12);renderCalendar();});
$("#back-current-month").addEventListener("click",()=>{viewDate=parseDate(today);renderCalendar();});
$("#cancel-record-edit").addEventListener("click",()=>openDay(editingDate));
$("#chart-range").addEventListener("click",event=>{const button=event.target.closest("[data-range]");if(!button)return;chartRange=Number(button.dataset.range);document.querySelectorAll("[data-range]").forEach(el=>el.setAttribute("aria-pressed",String(el===button)));renderStatistics();});
$("#chart-dimension").addEventListener("click",event=>{const button=event.target.closest("[data-dimension]");if(!button||button.dataset.dimension===chartDimension)return;chartDimension=button.dataset.dimension;chartType=["daily","monthly"].includes(chartDimension)?"line":"bar";renderStatistics();});
$("#chart-type").addEventListener("click",event=>{const button=event.target.closest("[data-chart-type]");if(!button)return;chartType=button.dataset.chartType;renderStatistics();});
if("ResizeObserver" in window){let chartWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width!==chartWidth){chartWidth=width;renderStatistics();}}).observe($("#chart-plot"));}
$("#day-form").addEventListener("submit",event=>{
  event.preventDefault();
  const occurredAt=new Date(`${editingDate}T${$("#day-time").value||"12:00"}:00`);
  if(occurredAt&&occurredAt.getTime()>Date.now()){toast("记录时间不能晚于现在。",true);return;}
  try{const next=editingId?editRecord(state,editingId,editingDate,"reset",occurredAt.toISOString()):setRecord(state,editingDate,"reset",occurredAt.toISOString());if(commit(next)){openDay(editingDate);toast("记录已保存，可以继续添加。");}}catch(error){toast(error.message,true);}
});
$("#delete-day").addEventListener("click",()=>{if(editingId&&commit(deleteRecord(state,editingId))){openDay(editingDate);toast("已删除这条记录。");}});
$("#recovery-form").addEventListener("submit",event=>{event.preventDefault();const start=new Date($("#recovery-start").value);if(!Number.isFinite(start.getTime())||start.getTime()>Date.now()){toast("请选择有效的过去时间。",true);return;}if(commit(setRecovery(state,start.toISOString()))){$("#recovery-dialog").close();toast("计时起点已更新。");}});
$("#reset-recovery").addEventListener("click",()=>{if(commit(setRecovery(state,null))){$("#recovery-dialog").close();toast("计时已跟随最近一次记录。");}});
$("#generate-key").addEventListener("click",()=>{if($("#sync-key").value&&!confirm("生成新密钥会打开另一份云端空间。旧空间只能通过旧密钥访问，请先保留原密钥。继续生成？"))return;$("#sync-key").value=createSyncKey();$("#sync-key").type="text";$("#toggle-key").textContent="隐藏";toast("密钥已生成，请复制并妥善备份。");});
$("#toggle-key").addEventListener("click",()=>{const input=$("#sync-key");input.type=input.type==="password"?"text":"password";$("#toggle-key").textContent=input.type==="password"?"显示":"隐藏";});
$("#copy-key").addEventListener("click",async()=>{const value=$("#sync-key").value;if(!value){toast("请先生成或填写同步密钥。",true);return;}try{await navigator.clipboard.writeText(value);toast("同步密钥已复制。");}catch{$("#sync-key").type="text";$("#sync-key").select();toast("请手动复制已选中的密钥。");}});
$("#cloud-form").addEventListener("submit",async event=>{
  event.preventDefault();let next;
  try{next=validateConnection({apiUrl:$("#api-url").value.trim(),key:$("#sync-key").value.trim()});}catch(error){toast(error.message,true);return;}
  if(connection&&connection.key!==next.key&&!confirm("连接另一串密钥会把当前本机记录合并到对应云端空间。请确认这是你自己的空间。继续连接？"))return;
  const previous=connection;
  try{saveCloud(next);connection=next;lastSync=null;}catch{toast("无法保存云端连接，请检查浏览器存储权限。",true);return;}
  const success=await syncNow({feedback:true});
  if(!success&&connection===next){connection=previous;try{saveCloud(previous);}catch{}renderCloud();}
});
$("#sync-now").addEventListener("click",()=>syncNow({feedback:true}));
$("#disconnect-cloud").addEventListener("click",()=>{try{saveCloud(null);}catch{toast("无法保存连接设置。",true);return;}connection=null;lastSync=null;lastError="";clearTimeout(syncTimer);$("#api-url").value="";$("#sync-key").value="";renderCloud();toast("已断开云端，本机与云端记录均保留。");});
$("#export-data").addEventListener("click",()=>{
  if(storageBlocked){const raw=localStorage.getItem(STATE_KEY);if(raw)download(raw,`lulema-original-${today}.json`);else toast("本机原始记录暂时无法读取。",true);return;}
  download(JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2),`lulema-backup-${today}.json`);toast("备份已导出，不包含同步密钥。");
});
function download(content,name){const url=URL.createObjectURL(new Blob([content],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$("#import-data").addEventListener("click",()=>$("#import-file").click());
$("#import-file").addEventListener("change",async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>8_000_000)throw new Error("备份文件过大");const backup=validateState(JSON.parse(await file.text())),count=Object.values(backup.records).filter(r=>r.status).length;
    if(!confirm(`导入 ${count} 条记录？不同记录会合并，同一条记录以备份为准。建议先导出当前记录。`))return;
    const next=importBackup(state,backup,today);if(commit(next))toast(`已导入 ${count} 条记录。`);
  }catch(error){toast(`导入失败：${error.message}`,true);}finally{event.target.value="";}
});
window.addEventListener("online",()=>{lastError="";scheduleSync(100);renderCloud();});
window.addEventListener("offline",()=>renderCloud());
window.addEventListener("storage",event=>{if(event.key===STATE_KEY&&event.newValue){try{state=mergeStates(state,validateState(JSON.parse(event.newValue)));render();scheduleSync();}catch{toast("另一标签页的记录无法读取，请检查数据。",true);}}});
function tick(){const next=dateKey();if(next!==today){const wasCurrent=viewDate.getFullYear()===parseDate(today).getFullYear()&&viewDate.getMonth()===parseDate(today).getMonth();today=next;if(wasCurrent)viewDate=parseDate(today);render();}else renderRecovery();if($("#day-dialog").open)updateDayTimeLimit();}
document.addEventListener("visibilitychange",()=>{if(!document.hidden){tick();scheduleSync(100);}});
setInterval(tick,30000);setInterval(()=>{if(connection&&navigator.onLine)scheduleSync(100);},60000);
render();if(storageBlocked)toast("无法读取本机记录，原始数据已保留。请检查浏览器存储权限。",true);else scheduleSync(100);
if("serviceWorker" in navigator)navigator.serviceWorker.register(new URL("../sw.js",import.meta.url),{scope:new URL("../",import.meta.url).pathname}).catch(()=>{});
