// 以本机无界面的 Chromium 和真实 SQLite 运行端到端检查，不连接外部服务。
import {spawn} from "node:child_process";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createServer} from "node:http";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
const root=resolve(import.meta.dirname,".."),out=resolve(root,"artifacts");
await mkdir(out,{recursive:true});
const db=new DatabaseSync(":memory:");db.exec(await readFile(resolve(root,"worker/migrations/0001_initial.sql"),"utf8"));db.exec(await readFile(resolve(root,"worker/migrations/0002_multiple_records.sql"),"utf8"));
const D1={prepare(sql){return {bind(...args){return {async all(){return {results:db.prepare(sql).all(...args)};},query(){return {results:db.prepare(sql).all(...args)};}};}};},async batch(queries){db.exec("BEGIN");try{const results=queries.map(q=>q.query());db.exec("COMMIT");return results;}catch(error){db.exec("ROLLBACK");throw error;}}};
const api=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),response=await worker.fetch(new Request(`http://127.0.0.1:8787${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}:{} )}),{DB:D1,ALLOWED_ORIGINS:"http://127.0.0.1:4173"});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500).end(error.message);}});
await new Promise(resolve=>api.listen(8787,"127.0.0.1",resolve));
const chrome=spawn(process.env.LULEMA_BROWSER||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update","--disable-sync","--remote-debugging-port=9731",`--user-data-dir=${resolve(out,"browser-profile")}`,"about:blank"],{windowsHide:true,stdio:"ignore"});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try {
  let info;
  for(let i=0;i<100;i++){try{info=await(await fetch("http://127.0.0.1:9731/json/version")).json();break;}catch{await pause(100);}}
  if(!info)throw new Error("Browser did not start");
  ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(new Error(JSON.stringify(data.error))):p.resolve(data.result);}}else if(data.method==="Runtime.exceptionThrown")errors.push(data.params.exceptionDetails);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  async function page(width,height,mobile=false){const {browserContextId}=await send("Target.createBrowserContext"),{targetId}=await send("Target.createTarget",{url:"about:blank",browserContextId}),{sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});await send("Runtime.enable",{},sessionId);await send("Page.enable",{},sessionId);await send("Network.enable",{},sessionId);await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile},sessionId);return {sessionId,async eval(expression){const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;},async navigate(){await send("Page.navigate",{url:"http://127.0.0.1:4173/lulema/"},sessionId);for(let i=0;i<100;i++){try{if(await this.eval(`document.querySelector('#current-streak')?.textContent === '0' && document.querySelector('#calendar-grid')?.children.length > 27`))return;}catch{}await pause(100);}throw new Error("Page did not render");},async screenshot(name){await this.eval("document.querySelector('#toast').hidden=true");const {contentSize}=await send("Page.getLayoutMetrics",{},sessionId);const {data}=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip:{x:0,y:0,width,height:contentSize.height,scale:1}},sessionId);await writeFile(resolve(out,name),Buffer.from(data,"base64"));}};}
  async function wait(page,expression){for(let i=0;i<100;i++){if(await page.eval(expression))return;await pause(100);}throw new Error(`UI condition failed: ${expression}`);}
  const desktop=await page(1440,1000);await desktop.navigate();
  assert.equal(await desktop.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  assert.equal(await desktop.eval("document.querySelectorAll('#statistics-section .chart-card').length"),1);
  assert.equal(await desktop.eval("document.querySelectorAll('.checkin-button').length === 1 && !document.querySelector('[data-status=clear]') && !document.querySelector('#day-form input[name=status]')"),true);
  assert.equal(await desktop.eval("document.querySelector('#statistics-chart').dataset.chartType"),"line");
  assert.equal(await desktop.eval("document.querySelector('#statistics-chart .chart-line').getAttribute('d')"),"");
  // 即使旧配置仍存在，也不再预填作者的地址；重新打开设置仍为空。
  await desktop.eval("window.LULEMA_CONFIG={apiUrl:'https://example.workers.dev'};document.querySelector('[data-action=settings]').click()");
  assert.equal(await desktop.eval("document.querySelector('#api-url').value"),"");
  await desktop.eval("document.querySelector('#api-url').value='https://example.workers.dev';document.querySelector('#settings-dialog').close();document.querySelector('[data-action=settings]').click()");
  assert.equal(await desktop.eval("document.querySelector('#api-url').value"),"");
  await desktop.eval("document.querySelector('#settings-dialog').close()");
  await desktop.screenshot("desktop-empty.png");
  await desktop.eval("document.querySelector('[data-status=reset]').click()");await wait(desktop,"document.querySelector('#reset-count').textContent === '1'");
  assert.equal(await desktop.eval("document.querySelector('#total-days').textContent === '1' && document.querySelector('#month-ratio').textContent === '0'"),true);
  await desktop.eval("location.reload()");await wait(desktop,"document.querySelector('#reset-count').textContent === '1'");
  // 原生输入限制和提交校验都阻止同一天的未来时间。
  await desktop.eval("document.querySelector('[data-action=edit-today]').click()");
  assert.equal(await desktop.eval("document.querySelector('#day-time').max === new Date().toTimeString().slice(0,5)"),true);
  const futureTime=await desktop.eval("(()=>{const now=new Date(),future=new Date(Date.now()+60000);return future.toDateString()===now.toDateString()?future.toTimeString().slice(0,5):null;})()");
  if(futureTime){await desktop.eval(`document.querySelector('#day-time').value=${JSON.stringify(futureTime)};document.querySelector('#day-form').requestSubmit()`);assert.equal(await desktop.eval("document.querySelector('#day-time').validity.rangeOverflow && document.querySelector('#reset-count').textContent === '1'"),true);await desktop.eval("document.querySelector('#day-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))");assert.equal(await desktop.eval("document.querySelector('#reset-count').textContent === '1' && document.querySelector('#toast').textContent.includes('晚于现在')"),true);}
  await desktop.eval("document.querySelector('#day-dialog').close()");
  // 同一天重复点击保存独立事件，修改只改变时间，删除只影响选中的事件。
  await desktop.eval("document.querySelector('[data-status=reset]').click();document.querySelector('[data-status=reset]').click();document.querySelector('[data-status=reset]').click()");
  await wait(desktop,"document.querySelector('#current-streak').textContent === '0' && document.querySelector('#total-days').textContent === '1' && document.querySelector('#reset-count').textContent === '4'");
  assert.equal(await desktop.eval("document.querySelector('.calendar-day.today .day-count').textContent"),"4次");
  await desktop.eval("document.querySelector('[data-action=edit-today]').click();document.querySelector('.record-row.reset [data-edit-record]').click();document.querySelector('#day-time').value='00:00';document.querySelector('#day-form').requestSubmit()");
  await wait(desktop,"document.querySelector('#reset-count').textContent === '4' && Array.from(document.querySelectorAll('.record-row')).some(row=>row.textContent.includes('00:00'))");
  await desktop.eval("document.querySelector('.record-row.reset [data-delete-record]').click()");
  await wait(desktop,"document.querySelector('#reset-count').textContent === '3'");
  await desktop.eval("Array.from(document.querySelectorAll('#day-records [data-delete-record]')).map(b=>b.dataset.deleteRecord).forEach(id=>document.querySelector('[data-delete-record=\"'+id+'\"]').click());document.querySelector('#day-dialog').close()");
  await wait(desktop,"document.querySelector('#total-days').textContent === '0' && document.querySelector('#reset-count').textContent === '0'");
  await desktop.eval(`(()=>{if(!document.querySelector('.calendar-day:not(:disabled):not(.today)'))document.querySelector('#previous-month').click();const day=document.querySelector('.calendar-day:not(:disabled):not(.today)');day.click();document.querySelector('#day-form').requestSubmit();document.querySelector('#day-dialog').close();})()`);await wait(desktop,"document.querySelector('#reset-count').textContent === '1'");
  await desktop.eval("document.querySelector('#back-current-month').click()");
  assert.equal(await desktop.eval(`(async()=>{const m=await import('./src/model.js'),s=m.statistics(m.validateState(JSON.parse(localStorage.getItem('lulema:state:v1'))));return Number(document.querySelector('#total-days').textContent)===s.totalDays&&Number(document.querySelector('#current-streak').textContent)===s.current&&s.current>0&&document.querySelector('.calendar-day.today').classList.contains('clear')&&document.querySelector('#today-badge').textContent==='今天没撸';})()`),true);
  await desktop.eval("document.querySelector('#previous-month').click()");assert.equal(await desktop.eval("document.querySelector('#back-current-month').hidden"),false);await desktop.eval("document.querySelector('#back-current-month').click()");
  await desktop.eval("document.querySelector('[data-action=recovery]').click();document.querySelector('#recovery-dialog').close()");
  // 连接自己的本机 Worker 模拟器，两个独立浏览器空间共享同一密钥。
  const key=await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#generate-key').click();document.querySelector('#sync-key').value");
  await desktop.eval("document.querySelector('#api-url').value='http://127.0.0.1:8787';document.querySelector('#cloud-form').requestSubmit()");
  await wait(desktop,"document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  await desktop.eval("document.querySelector('[data-action=settings]').click()");
  assert.equal(await desktop.eval("document.querySelector('#api-url').value"),"http://127.0.0.1:8787");
  await desktop.eval("document.querySelector('#settings-dialog').close()");
  // 模拟已有浏览器中的 v1 数据，升级后原记录仍可编辑并继续新增。
  const legacyPage=await page(360,800,true);await legacyPage.navigate();
  await legacyPage.eval(`(()=>{const date=new Date(),day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');localStorage.setItem('lulema:state:v1',JSON.stringify({version:1,records:{[day]:{date:day,status:'clear',occurredAt:null,updatedAt:1,mutationId:'legacy_ui_01'}},recovery:null}));window.legacyReloadMarker=true;location.reload();})()`);
  await wait(legacyPage,"!window.legacyReloadMarker && document.querySelector('#calendar-grid')?.children.length>27 && document.querySelector('#total-days').textContent === '0' && document.querySelector('#reset-count').textContent === '0'");
  await legacyPage.eval("document.querySelector('[data-status=reset]').click();document.querySelector('[data-status=reset]').click()");await wait(legacyPage,"document.querySelector('#total-days').textContent === '1' && document.querySelector('#reset-count').textContent === '2'");
  assert.equal(await legacyPage.eval("JSON.parse(localStorage.getItem('lulema:state:v1')).version"),2);assert.equal(await legacyPage.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  assert.equal(await legacyPage.eval("Object.values(JSON.parse(localStorage.getItem('lulema:state:v1')).records).filter(r=>r.status==='clear').length"),1);
  const mobile=await page(390,844,true);await mobile.navigate();
  assert.equal(await mobile.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  await mobile.screenshot("mobile-empty.png");
  await mobile.eval(`document.querySelector('[data-action=settings]').click();document.querySelector('#api-url').value='http://127.0.0.1:8787';document.querySelector('#sync-key').value=${JSON.stringify(key)};document.querySelector('#cloud-form').requestSubmit()`);
  await wait(mobile,"document.querySelector('#cloud-detail').textContent.startsWith('已同步') && document.querySelector('#reset-count').textContent === '1'");await mobile.eval("document.querySelector('#settings-dialog').close();document.querySelector('[data-status=reset]').click()");await wait(mobile,"document.querySelector('#reset-count').textContent === '2' && document.querySelector('#sync-label').textContent === '云端已连接'");
  await pause(1000);await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#reset-count').textContent === '2' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  // 删除跨设备传播。
  await mobile.eval("document.querySelector('[data-action=edit-today]').click();document.querySelector('#day-records [data-delete-record]').click();document.querySelector('#day-dialog').close()");await pause(1000);await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#reset-count').textContent === '1' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  assert.equal(await desktop.eval("document.querySelector('.calendar-day.today').classList.contains('clear') && Number(document.querySelector('#current-streak').textContent)>0"),true);
  // 安装离线缓存并断网继续打卡。
  await mobile.eval("navigator.serviceWorker.ready.then(()=>true)");await pause(500);
  await send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},mobile.sessionId);
  await mobile.eval("document.querySelector('[data-status=reset]').click()");assert.equal(await mobile.eval("document.querySelector('#reset-count').textContent"),"2");
  await mobile.eval("location.reload()");await wait(mobile,"document.querySelector('#reset-count').textContent === '2'");
  await send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},mobile.sessionId);await mobile.eval("window.dispatchEvent(new Event('online'))");await pause(1200);
  await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#reset-count').textContent === '2' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  // 使用真实导入入口补充历史数据，检查统计和备份重复导入。
  const seeded=await desktop.eval(`(async()=>{const m=await import('./src/model.js');let s=m.emptyState();const today=m.dateKey();for(let i=1;i<=65;i++){if(i%5===0)continue;const date=m.shiftDate(today,-i);const at=m.parseDate(date);at.setHours((i*7)%24,15,0,0);if(i%3===0)for(let j=0;j<i%4+1;j++)s=m.setRecord(s,date,'reset',at.toISOString());}return s;})()`);
  async function importFile(page,backup){await page.eval(`(()=>{const data=${JSON.stringify(backup)},file=new File([JSON.stringify(data)],'test-backup.json',{type:'application/json'}),transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('#import-file');input.files=transfer.files;const original=window.confirm;window.confirm=()=>true;input.dispatchEvent(new Event('change'));setTimeout(()=>window.confirm=original,300);})()`);await wait(page,"document.querySelector('#reset-count').textContent !== '2'");}
  await importFile(desktop,seeded);const total=await desktop.eval("document.querySelector('#reset-count').textContent");await importFile(desktop,seeded);await pause(400);assert.equal(await desktop.eval("document.querySelector('#reset-count').textContent"),total);
  const futureBackup=await desktop.eval(`(async()=>{const m=await import('./src/model.js'),s=m.validateState(JSON.parse(localStorage.getItem('lulema:state:v1'))),id=Object.keys(s.records).find(id=>s.records[id].status==='reset');s.records[id]={...s.records[id],date:m.dateKey(),occurredAt:new Date(Date.now()+60000).toISOString()};return s;})()`);
  await importFile(desktop,futureBackup);await wait(desktop,"document.querySelector('#toast').textContent.includes('导入失败') && document.querySelector('#toast').textContent.includes('晚于现在')");
  assert.equal(await desktop.eval("document.querySelector('#reset-count').textContent"),total);
  await desktop.eval("document.querySelectorAll('[data-range]')[0].click()");assert.equal(await desktop.eval("document.querySelector('#chart-data').children.length"),7);
  await desktop.eval("document.querySelectorAll('[data-range]')[2].click()");assert.equal(await desktop.eval("document.querySelector('#chart-data').children.length"),90);
  assert.equal(await desktop.eval("Array.from(document.querySelectorAll('#chart-data tr')).some(row=>row.cells[1].textContent==='未纳入统计')"),true);
  await desktop.eval("document.querySelectorAll('[data-range]')[1].click()");
  // 首次记录后的空白日期按零次连接，不再产生断点。
  assert.equal(await desktop.eval(`(()=>{const rows=Array.from(document.querySelectorAll('#chart-data tr')),path=document.querySelector('.chart-line').getAttribute('d');return (path.match(/M/g)||[]).length===1&&(path.match(/L/g)||[]).length===29&&rows.some(row=>row.cells[1].textContent==='0 次')&&rows.every(row=>row.cells[1].textContent!=='未纳入统计');})()`),true);
  const rangeTotal=await desktop.eval(`(async()=>{const m=await import('./src/model.js'),state=m.validateState(JSON.parse(localStorage.getItem('lulema:state:v1')));return m.chartStatistics(state,m.dateKey(),30).total;})()`);
  for(const [dimension,rows] of [["weekday",7],["period",4],["monthly",6]]) {
    await desktop.eval(`document.querySelector('[data-dimension=${dimension}]').click()`);
    assert.equal(await desktop.eval("document.querySelector('#chart-data').children.length"),rows);
    assert.equal(await desktop.eval("document.querySelector('#statistics-chart').dataset.chartType"),dimension==="monthly"?"line":"bar");
    if(dimension!=="monthly")assert.equal(await desktop.eval("Array.from(document.querySelectorAll('#chart-data tr')).reduce((sum,row)=>sum+parseInt(row.cells[1].textContent),0)"),rangeTotal);
    else {
      assert.equal(await desktop.eval("document.querySelector('#chart-range').hidden && !document.querySelector('#chart-month-range').hidden"),true);
      assert.equal(await desktop.eval(`(async()=>{const m=await import('./src/model.js'),state=m.validateState(JSON.parse(localStorage.getItem('lulema:state:v1'))),stats=m.chartStatistics(state,m.dateKey(),30),total=stats.months.reduce((sum,month)=>sum+month.count,0),days=stats.months.reduce((sum,month)=>sum+month.days,0);return document.querySelector('#chart-summary').textContent==='最近 6 个月 · 撸了 '+total+' 次 · 纳入统计 '+days+' 天';})()`),true);
    }
    await desktop.eval("document.querySelector('#chart-type [data-chart-type=line]').click()");
    assert.equal(await desktop.eval("document.querySelector('#statistics-chart').dataset.chartType"),"line");
    await desktop.eval("document.querySelector('#chart-type [data-chart-type=bar]').click()");
    assert.equal(await desktop.eval("document.querySelector('#statistics-chart').dataset.chartType"),"bar");
    await desktop.eval("document.querySelector('[data-chart-index=\"0\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    assert.equal(await desktop.eval("document.querySelector('#chart-point-detail').textContent === document.querySelector('#chart-data tr').cells[0].textContent+' · '+document.querySelector('#chart-data tr').cells[1].textContent"),true);
  }
  await desktop.eval("document.querySelector('[data-dimension=daily]').click()");
  assert.equal(await desktop.eval("!document.querySelector('#chart-range').hidden && document.querySelector('[data-range=\"30\"]').getAttribute('aria-pressed') === 'true' && document.querySelector('#chart-data').children.length === 30"),true);
  await desktop.eval("document.querySelector('[data-action=recovery]').click();document.querySelector('#recovery-start').value=(()=>{const d=new Date(Date.now()-60*3600000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');})();document.querySelector('#recovery-form').requestSubmit()");
  assert.equal(await desktop.eval("document.querySelector('#energy-stage').textContent"),"两日积累");
  await wait(desktop,"document.querySelector('#sync-label').textContent === '云端已连接'");await pause(900);
  await mobile.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(mobile,`document.querySelector('#reset-count').textContent === '${total}' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')`);await mobile.eval("document.querySelector('#settings-dialog').close()");
  assert.equal(await mobile.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  for(const dimension of ["weekday","period","monthly","daily"]){await mobile.eval(`document.querySelector('[data-dimension=${dimension}]').click()`);assert.equal(await mobile.eval("document.documentElement.scrollWidth <= innerWidth"),true);}
  await mobile.eval("document.querySelector('[data-chart-index=\"0\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  assert.equal(await mobile.eval("document.querySelector('#chart-point-detail').textContent.includes(' · ')"),true);
  await desktop.screenshot("desktop.png");await mobile.screenshot("mobile.png");
  await mobile.eval("document.querySelector('[data-action=edit-today]').click()");await mobile.screenshot("mobile-records.png");
  await mobile.eval("document.querySelector('#day-dialog').close();document.querySelector('[data-action=settings]').click();document.querySelector('#disconnect-cloud').click()");
  assert.equal(await mobile.eval("document.querySelector('#api-url').value === '' && localStorage.getItem('lulema:cloud:v1') === null"),true);
  await mobile.eval("document.querySelector('#settings-dialog').close();document.querySelector('[data-action=settings]').click()");
  assert.equal(await mobile.eval("document.querySelector('#api-url').value"),"");
  assert.deepEqual(errors,[]);console.log("Browser checks passed: event-only entry and edits, future-time rejection, automatic clear days and streaks, first-event timeline, chart zero filling/dimensions/ranges, legacy compatibility, backups, desktop/mobile, D1 sync, deletion and offline reconnection. Screenshots: artifacts/desktop.png, artifacts/mobile.png");
} finally {if(ws?.readyState===1){try{ws.send(JSON.stringify({id:999999,method:"Browser.close"}));}catch{}ws.close();}chrome.kill();await new Promise(resolve=>api.close(resolve));db.close();}
