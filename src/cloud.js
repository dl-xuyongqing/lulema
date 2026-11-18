import {mergeStates,validateState,normalizeApiUrl,SYNC_KEY_PATTERN} from "./model.js";
export function validateConnection(connection) {
  if(!SYNC_KEY_PATTERN.test(connection.key)) throw new Error("同步密钥格式不正确，请生成新密钥或粘贴完整的已有密钥");
  return {apiUrl:normalizeApiUrl(connection.apiUrl),key:connection.key};
}
export async function requestCloud(connection,path,options={}) {
  const headers={Authorization:`Bearer ${connection.key}`,Accept:"application/json",...options.headers};
  if(options.body) headers["Content-Type"]="application/json";
  let response;
  try { response=await fetch(`${connection.apiUrl}${path}`,{...options,headers,cache:"no-store",credentials:"omit",redirect:"error",signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error(navigator.onLine===false?"当前离线，恢复网络后会自动同步":"无法连接云端，请检查服务地址、网络和允许访问的网站配置"); }
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.error||`云端返回错误（${response.status}）`);
  return data;
}
export async function synchronize(connection,local) {
  const remote=validateState(await requestCloud(connection,"/api/state"));
  const merged=mergeStates(local,remote);
  const changed={version:1,records:{},recovery:null};
  for(const [date,record] of Object.entries(merged.records))if(record.mutationId!==remote.records[date]?.mutationId)changed.records[date]=record;
  if(merged.recovery?.mutationId!==remote.recovery?.mutationId)changed.recovery=merged.recovery;
  if(!Object.keys(changed.records).length&&!changed.recovery)return remote;
  return validateState(await requestCloud(connection,"/api/sync",{method:"POST",body:JSON.stringify(changed)}));
}
