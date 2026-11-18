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
const db=new DatabaseSync(":memory:");db.exec(await readFile(resolve(root,"worker/migrations/0001_initial.sql"),"utf8"));
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
  async function page(width,height,mobile=false){const {browserContextId}=await send("Target.createBrowserContext"),{targetId}=await send("Target.createTarget",{url:"about:blank",browserContextId}),{sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});await send("Runtime.enable",{},sessionId);await send("Page.enable",{},sessionId);await send("Network.enable",{},sessionId);await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile},sessionId);return {sessionId,async eval(expression){const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;},async navigate(){await send("Page.navigate",{url:"http://127.0.0.1:4173/lulema/"},sessionId);for(let i=0;i<100;i++){try{if(await this.eval(`document.querySelector('#current-streak')?.textContent === '0' && document.querySelector('#calendar-grid')?.children.length > 27`))return;}catch{}await pause(100);}throw new Error("Page did not render");},async screenshot(name){const {contentSize}=await send("Page.getLayoutMetrics",{},sessionId);const {data}=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip:{x:0,y:0,width,height:contentSize.height,scale:1}},sessionId);await writeFile(resolve(out,name),Buffer.from(data,"base64"));}};}
  async function wait(page,expression){for(let i=0;i<100;i++){if(await page.eval(expression))return;await pause(100);}throw new Error(`UI condition failed: ${expression}`);}
  const desktop=await page(1440,1000);await desktop.navigate();
  assert.equal(await desktop.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  await desktop.screenshot("desktop-empty.png");
  await desktop.eval("document.querySelector('[data-status=clear]').click()");await wait(desktop,"document.querySelector('#current-streak').textContent === '1'");
  await desktop.eval("location.reload()");await wait(desktop,"document.querySelector('#current-streak').textContent === '1'");
  await desktop.eval("document.querySelector('[data-status=reset]').click()");await wait(desktop,"document.querySelector('#current-streak').textContent === '0' && document.querySelector('#total-days').textContent === '1'");
  await desktop.eval("document.querySelector('[data-action=edit-today]').click();document.querySelector('#delete-day').click()");await wait(desktop,"document.querySelector('#total-days').textContent === '0'");
  await desktop.eval(`(()=>{const day=document.querySelector('.calendar-day:not(:disabled):not(.today)');day.click();document.querySelector('#day-form input[value=clear]').click();document.querySelector('#day-form').requestSubmit();})()`);await wait(desktop,"document.querySelector('#total-days').textContent === '1'");
  await desktop.eval("document.querySelector('#previous-month').click()");assert.equal(await desktop.eval("document.querySelector('#back-current-month').hidden"),false);await desktop.eval("document.querySelector('#back-current-month').click()");
  await desktop.eval("document.querySelector('[data-action=recovery]').click();document.querySelector('#recovery-dialog').close()");
  // 连接自己的本机 Worker 模拟器，两个独立浏览器空间共享同一密钥。
  const key=await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#generate-key').click();document.querySelector('#sync-key').value");
  await desktop.eval("document.querySelector('#api-url').value='http://127.0.0.1:8787';document.querySelector('#cloud-form').requestSubmit()");
  await wait(desktop,"document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  const mobile=await page(390,844,true);await mobile.navigate();
  assert.equal(await mobile.eval("document.documentElement.scrollWidth <= innerWidth"),true);
  await mobile.screenshot("mobile-empty.png");
  await mobile.eval(`document.querySelector('[data-action=settings]').click();document.querySelector('#api-url').value='http://127.0.0.1:8787';document.querySelector('#sync-key').value=${JSON.stringify(key)};document.querySelector('#cloud-form').requestSubmit()`);
  await wait(mobile,"document.querySelector('#cloud-detail').textContent.startsWith('已同步') && document.querySelector('#total-days').textContent === '1'");await mobile.eval("document.querySelector('#settings-dialog').close();document.querySelector('[data-status=clear]').click()");await wait(mobile,"document.querySelector('#total-days').textContent === '2' && document.querySelector('#sync-label').textContent === '云端已连接'");
  await pause(1000);await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#total-days').textContent === '2' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  // 删除跨设备传播。
  await mobile.eval("document.querySelector('[data-action=edit-today]').click();document.querySelector('#delete-day').click()");await pause(1000);await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#total-days').textContent === '1' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  // 安装离线缓存并断网继续打卡。
  await mobile.eval("navigator.serviceWorker.ready.then(()=>true)");await pause(500);
  await send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},mobile.sessionId);
  await mobile.eval("document.querySelector('[data-status=reset]').click()");assert.equal(await mobile.eval("document.querySelector('#total-days').textContent"),"2");
  await mobile.eval("location.reload()");await wait(mobile,"document.querySelector('#total-days').textContent === '2'");
  await send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},mobile.sessionId);await mobile.eval("window.dispatchEvent(new Event('online'))");await pause(1200);
  await desktop.eval("document.querySelector('[data-action=settings]').click();document.querySelector('#sync-now').click()");await wait(desktop,"document.querySelector('#total-days').textContent === '2' && document.querySelector('#cloud-detail').textContent.startsWith('已同步')");await desktop.eval("document.querySelector('#settings-dialog').close()");
  await desktop.screenshot("desktop.png");await mobile.screenshot("mobile.png");
  assert.deepEqual(errors,[]);console.log("Browser checks passed: desktop/mobile, persistence, edit/delete, two-device D1 sync, deletion sync, offline reload and reconnection. Screenshots: artifacts/desktop.png, artifacts/mobile.png");
} finally {if(ws?.readyState===1){try{ws.send(JSON.stringify({id:999999,method:"Browser.close"}));}catch{}ws.close();}chrome.kill();await new Promise(resolve=>api.close(resolve));db.close();}
