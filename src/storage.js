import {emptyState,validateState} from "./model.js";
export const STATE_KEY="lulema:state:v1";
export const CLOUD_KEY="lulema:cloud:v1";
export function loadState(storage=localStorage) {
  const raw=storage.getItem(STATE_KEY);
  return raw?validateState(JSON.parse(raw)):emptyState();
}
export function saveState(state,storage=localStorage) { storage.setItem(STATE_KEY,JSON.stringify(state)); }
export function loadCloud(storage=localStorage) {
  const raw=storage.getItem(CLOUD_KEY);
  if(!raw) return null;
  const value=JSON.parse(raw);
  if(!value||typeof value.apiUrl!=="string"||typeof value.key!=="string") return null;
  return value;
}
export function saveCloud(value,storage=localStorage) {
  if(value) storage.setItem(CLOUD_KEY,JSON.stringify(value)); else storage.removeItem(CLOUD_KEY);
}
