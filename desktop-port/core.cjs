'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function isTrustedNativeURL(input) {
  try {
    const url = new URL(input);
    return url.origin === 'https://bilipc.bilibili.com'
      && !url.username && !url.password
      && /^\/(index|player|search)\.html$/.test(url.pathname);
  } catch {
    return false;
  }
}
class SerialStore {
  constructor(file,changed=()=>{}) { this.file=file;this.changed=changed;this.queue=Promise.resolve();this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{}; }
  serial(fn) { const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p; }
  get(keys) {return this.serial(()=>{if(keys==null)return copy(this.data);const out={};for(const k of typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys)){out[k]=copy(this.data[k]??(!Array.isArray(keys)&&typeof keys==='object'?keys[k]:undefined));}return out;});}
  set(values) {return this.serial(()=>{const changes={};for(const key of Object.keys(values))if(!key.startsWith('margin:'))throw Error('Storage namespace rejected');for(const [key,v] of Object.entries(values)){if(JSON.stringify(this.data[key])===JSON.stringify(v))continue;changes[key]={oldValue:copy(this.data[key]),newValue:copy(v)};this.data[key]=copy(v);}this.persist(changes);});}
  remove(keys) {return this.serial(()=>{const changes={};for(const key of typeof keys==='string'?[keys]:keys){if(!key.startsWith('margin:'))throw Error('Storage namespace rejected');if(key in this.data){changes[key]={oldValue:copy(this.data[key])};delete this.data[key];}}this.persist(changes);});}
  persist(changes){if(!Object.keys(changes).length)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);this.changed(changes);}
}
function assetPath(root,input){
  if(typeof input!=='string'||!input.startsWith('margin://app/'))throw Error('Invalid asset origin');
  const raw=input.slice('margin://app/'.length).split(/[?#]/)[0],decoded=decodeURIComponent(raw);
  if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(p=>p==='..'||p==='.')||decoded.startsWith('/'))throw Error('Invalid asset path');
  const result=path.resolve(root,decoded);if(!result.startsWith(path.resolve(root)+path.sep))throw Error('Invalid asset path');return result;
}
const hosts=['bilibili.com','biliapi.net','biliapi.com','hdslb.com','bilivideo.com','bilivideo.cn','akamaized.net','ipwho.is','open-meteo.com'];
function allowedURL(input){const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('Network origin rejected');return u;}
function createWorker(source,store,fetchImpl,timeout=30000){
  const listeners=[];
  const chrome={storage:{local:{get:k=>store.get(k),set:v=>store.set(v),remove:k=>store.remove(k)}},runtime:{onMessage:{addListener:fn=>listeners.push(fn)},onInstalled:{addListener:()=>{}}}};
  const context=vm.createContext({chrome,fetch:fetchImpl,URL,URLSearchParams,TextEncoder,TextDecoder,console,setTimeout,clearTimeout});
  new vm.Script(source,{filename:'upstream-background.js'}).runInContext(context);
  return {send(message,sender={}){return new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('Background reply timeout'));}},timeout);const reply=value=>{if(done)return;done=true;clearTimeout(timer);resolve(copy(value));};try{let handled=false;for(const listener of listeners){if(listener(copy(message),sender,reply)===true)handled=true;if(done)break;}if(!handled&&!done){done=true;clearTimeout(timer);reject(Error('Unhandled background message'));}}catch(e){clearTimeout(timer);reject(e);}});}};
}
module.exports={SerialStore,assetPath,allowedURL,createWorker,isTrustedNativeURL};
