'use strict';
const {app,protocol,session,ipcMain,BrowserWindow,net,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const {SerialStore,assetPath,allowedURL,createWorker,isTrustedNativeURL}=require('./core.cjs');
const {classifyRoute,isGuestURL,routeBridge}=require('./routes.cjs');
const localAppData = process.env.LOCALAPPDATA;
// Windows shortcuts and protocol handlers can launch the installed copy directly.
const root = process.env.MARGIN_DESKTOP_ROOT ||
  (localAppData && path.isAbsolute(localAppData) && path.join(localAppData, 'MARGIN-Bilibili', 'DesktopProfile'));
if(!root||!path.isAbsolute(root))throw Error('MARGIN_DESKTOP_ROOT must be an absolute isolated profile directory');
fs.mkdirSync(root,{recursive:true});
const log=(event,detail={})=>fs.appendFileSync(path.join(root,'host-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...detail})+'\n');
const isolated={userData:'profile',sessionData:'session',logs:'logs',crashDumps:'crashes',cache:'cache'};
const setPath=app.setPath.bind(app);
for(const [key,name]of Object.entries(isolated)){isolated[key]=path.join(root,name);fs.mkdirSync(isolated[key],{recursive:true});try{setPath(key,isolated[key]);}catch{}}
app.setPath=(key,value)=>setPath(key,isolated[key]||value);app.setAppLogsPath(isolated.logs);
// The official updater must not overwrite this experimental copy.
const Module=require('node:module'),load=Module._load;
Module._load=function(request){const result=load.apply(this,arguments);if(request==='electron-updater'&&result?.autoUpdater){result.autoUpdater.autoDownload=false;result.autoUpdater.checkForUpdates=async()=>null;result.autoUpdater.checkForUpdatesAndNotify=async()=>null;result.autoUpdater.quitAndInstall=()=>log('update-disabled');}return result;};
protocol.registerSchemesAsPrivileged([{scheme:'margin',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const clients=new Set();
const guest = contents => contents.getType()==='browserView' && isGuestURL(contents.getURL());
const trusted = contents => isTrustedNativeURL(contents.getURL()) || guest(contents);
const appAuthKey = 'margin:app-auth';
const store=new SerialStore(path.join(root,'margin-storage.json'),changes=>{
  delete changes[appAuthKey];
  if (!Object.keys(changes).length) return;
  for (const c of clients) if (!c.isDestroyed() && trusted(c)) c.send('margin:storageChanged',changes);
});
function request(url,options={}){allowedURL(url);return new Promise((resolve,reject)=>{const r=net.request({url,method:options.method||'GET',session:session.defaultSession,redirect:'manual',useSessionCookies:options.credentials==='include'});r.on('redirect',(_code,_method,next)=>{try{allowedURL(next);r.followRedirect();}catch(e){r.abort();reject(e);}});for(const [k,v]of Object.entries(options.headers||{})){if(/^(host|cookie|origin|referer|connection)$/i.test(k))continue;r.setHeader(k,String(v));}r.on('response',response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,headers:response.headers,body,json:async()=>JSON.parse(body),text:async()=>body});});response.on('error',reject);});r.on('error',reject);if(options.body)r.write(String(options.body));r.end();});}
const worker=createWorker(fs.readFileSync(path.join(__dirname,'assets/background.js'),'utf8'),store,request);
function handle(name,fn){ipcMain.handle('margin:'+name,(event,...args)=>{if(!trusted(event.sender)||event.senderFrame!==event.sender.mainFrame)throw Error('Untrusted MARGIN sender');return fn(...args,event.sender);});}
handle('storageGet', async keys => {
  const values = await store.get(keys);
  delete values[appAuthKey];
  return values;
});
handle('storageSet', values => {
  if (Object.hasOwn(values, appAuthKey)) throw Error('App authorization is handled by the worker');
  return store.set(values);
});
handle('storageRemove', keys => {
  if ([keys].flat().includes(appAuthKey)) throw Error('App authorization is handled by the worker');
  return store.remove(keys);
});
handle('message',(m,sender)=>worker.send(m,{tab:{id:sender.id},url:sender.getURL()}));
handle('fetch',async(url,options,sender)=>{
  if (!isTrustedNativeURL(sender.getURL())) throw Error('Native network bridge is unavailable on website pages');
  const r=await request(url,options);
  return {ok:r.ok,status:r.status,body:r.body};
});
handle('refreshAccount', (...args) => {
  const sender = args.at(-1);
  const url = sender.getURL();
  if (!isTrustedNativeURL(url) || new URL(url).pathname !== '/index.html') throw Error('Only the native main window can refresh its account');
  // The official shell can suppress a renderer-initiated location.reload().
  // Reload this verified main document through its own webContents instead.
  setTimeout(() => {
    if (!sender.isDestroyed() && sender.getURL().split('#')[0] === url.split('#')[0]) sender.reload();
  }, 0);
  return true;
});
async function navigate(url,sender){
  const route=classifyRoute(url);
  if(route.kind==='external'){
    await shell.openExternal(route.url);
    log('external-open',{host:new URL(route.url).hostname});return {kind:'external'};
  }
  const main=[...clients].find(c=>!c.isDestroyed()&&isTrustedNativeURL(c.getURL())&&new URL(c.getURL()).pathname==='/index.html');
  const caller=isTrustedNativeURL(sender.getURL())?sender:main;
  if(!caller)throw Error('Native main window is unavailable');
  const target = new URL(route.url);
  log('route',{id:sender.id,kind:route.kind,host:target.hostname,path:target.pathname});
  if (route.kind === 'home' && main) {
    await main.executeJavaScript(`(async () => {
      await window.marginDesktopRuntime?.mountHome();
      return window.biliBridgePc.callNative('window/openMainWindow', {unmini: true});
    })()`);
    return {kind:route.kind};
  }
  const {method,payload}=routeBridge(route);
  if (route.kind === 'search' && method === 'window/openMainWindowPage' && main) {
    await main.executeJavaScript(`(async () => {
      await window.biliBridgePc.callNative('window/openMainWindow', {unmini: true});
      const payload = ${JSON.stringify(payload)};
      if (window.marginDesktopRuntime) return window.marginDesktopRuntime.openNativeSearch(payload);
      return window.biliBridgePc.callNative(${JSON.stringify(method)}, payload);
    })()`);
    return {kind:route.kind};
  }
  await caller.executeJavaScript(`window.biliBridgePc.callNative(${JSON.stringify(method)}${payload===undefined?'':','+JSON.stringify(payload)})`);
  return {kind:route.kind};
}
handle('open',navigate);
// The synchronous response contains only our own bootstrap and settings mirror.
// Both the committed top frame and BrowserView identity are checked before exposure.
const boot=fs.readFileSync(path.join(__dirname,'assets/desktop-bootstrap.js'),'utf8');
const guestEntry=fs.readFileSync(path.join(__dirname,'assets/content.js'),'utf8');
const cdn=fs.readFileSync(path.join(__dirname,'assets/cdn.js'),'utf8');
const playerEntry=fs.readFileSync(path.join(__dirname,'native-player.js'),'utf8');
const searchEntry=fs.readFileSync(path.join(__dirname,'assets/search-particles.js'),'utf8');
ipcMain.on('margin:bootstrap',(event)=>{
  const sender = event.sender;
  const frame = event.senderFrame;
  if (!frame || !trusted(sender) || frame !== sender.mainFrame || frame.url !== sender.getURL()) {
    log('bootstrap-deferred', {id: sender.id, type: sender.getType(), top: frame === sender.mainFrame, trusted: trusted(sender), frameURL: !!frame?.url, sameURL: frame?.url === sender.getURL()});
    event.returnValue = null;
    return;
  }
  const c=event.sender;clients.add(c);const settings=store.data['margin:settings']||{};
  const player=isTrustedNativeURL(c.getURL())&&new URL(c.getURL()).pathname==='/player.html';
  const ordinary=guest(c);
  log('bootstrap-authorized',{id:c.id,type:c.getType(),url:c.getURL(),defaultSession:c.session===session.defaultSession,player,guest:ordinary});
  const mirror=`try{const s=${JSON.stringify(settings)};if(s.enabled!==false&&s.cdn)localStorage.setItem('margin:cdn',s.cdn);else localStorage.removeItem('margin:cdn');}catch{};`;
  const ready=source=>`(()=>{const start=()=>{${source}\n};if(document.documentElement)start();else{const o=new MutationObserver(()=>{if(document.documentElement){o.disconnect();start();}});o.observe(document,{childList:true,subtree:true});}})();`;
  event.returnValue={source:boot+mirror+ready(searchEntry)+((ordinary||player)?cdn:'')+(ordinary?ready(guestEntry):player?ready(playerEntry):'')};
});
ipcMain.on('margin:log',(event,name,detail)=>{if(trusted(event.sender))log(String(name),{id:event.sender.id,detail});});
const sessions=new WeakSet();
const assetsRoot = path.join(__dirname, 'assets');
// Keep session preloads readable while the official launcher unpacks its ASAR.
const preloadPath = path.join(process.resourcesPath, 'margin-desktop-preload.cjs');
const assets = new Map();
function readAssets(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) readAssets(file);
    else if (entry.isFile()) assets.set(file, fs.readFileSync(file));
  }
}
// Read our resources before the official boot code starts unpacking its own ASAR.
readAssets(assetsRoot);
function setupSession(s){if(sessions.has(s))return;sessions.add(s);s.setPreloads([...s.getPreloads(),preloadPath]);s.protocol.registerBufferProtocol('margin',(req,callback)=>{try{const file=assetPath(assetsRoot,req.url);const data=assets.get(file);if(!data)throw Error('Missing MARGIN resource');const mime={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream';callback({data,mimeType:mime,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'}});}catch(e){log('asset-error',{url:req.url,message:e.message});callback({statusCode:404,data:Buffer.from('Not found')});}});}
app.on('session-created',setupSession);
app.whenReady().then(()=>setupSession(session.defaultSession));
const renderer=fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8');
const guardedPlayers = new WeakSet();
const retriedPreloads = new WeakSet();
function protectPlayerResize(contents) {
  const win = BrowserWindow.fromWebContents(contents);
  if (!win || guardedPlayers.has(win)) return;
  guardedPlayers.add(win);
  win.on('will-resize', (event, bounds) => {
    if (!isTrustedNativeURL(contents.getURL()) || new URL(contents.getURL()).pathname !== '/player.html') return;
    const [width, height] = win.getContentSize();
    const [outerWidth, outerHeight] = win.getSize();
    const zoom = contents.getZoomFactor();
    // The official renderer uses CSS pixels and changes to mini at <= 820×460.
    // Dragging the border must not cross that limit. The native mini command
    // still sets its own bounds programmatically, without a will-resize event.
    if (width / zoom > 820 && height / zoom > 460 &&
        ((bounds.width - (outerWidth - width)) / zoom <= 820 ||
         (bounds.height - (outerHeight - height)) / zoom <= 460)) event.preventDefault();
  });
}
app.on('web-contents-created',(_e,c)=>{
  setupSession(c.session);
  c.on('preload-error', (_event, file, error) => {
    if (file === preloadPath) log('preload-error', {id: c.id, message: error.message});
  });
  const intercept=(event,url)=>{if(!trusted(c)||isTrustedNativeURL(url))return;try{const route=classifyRoute(url);if(isTrustedNativeURL(c.getURL())||['video','live','login','home'].includes(route.kind)){event.preventDefault();navigate(url,c).catch(e=>log('navigation-error',{id:c.id,message:e.message}));}}catch{if(isTrustedNativeURL(c.getURL()))event.preventDefault();}};
  c.on('will-navigate',intercept);c.on('will-redirect',intercept);
  c.setWindowOpenHandler(({url})=>{if(!trusted(c))return {action:'allow'};navigate(url,c).catch(e=>log('navigation-error',{id:c.id,message:e.message}));return {action:'deny'};});
  c.on('did-finish-load', async () => {
    if (!trusted(c)) return;
    const url = c.getURL();
    const stillHere = () => !c.isDestroyed() && c.getURL().split('#')[0] === url.split('#')[0];
    clients.add(c);
    log('native-page', {id: c.id, url, type: c.getType(), defaultSession: c.session === session.defaultSession});
    try {
      const ready = await c.executeJavaScript('Boolean(window.marginDesktop)');
      if (!stillHere()) return;
      if (!ready) {
        // Electron can reuse an initial renderer that missed the session preload.
        // Reload once to start the same trusted document with the registered preload.
        if (!retriedPreloads.has(c)) {
          retriedPreloads.add(c);
          log('preload-reload', {id: c.id});
          c.reload();
        } else log('preload-unavailable', {id: c.id});
        return;
      }
      retriedPreloads.delete(c);
      if (!isTrustedNativeURL(url)) return;
      const page = new URL(url).pathname;
      if (page === '/player.html') protectPlayerResize(c);
      if (page !== '/index.html') return;
      await c.executeJavaScript(renderer);
      log('renderer-attached', {id: c.id});
    } catch (error) {
      if (stillHere()) log('renderer-error', {id: c.id, message: error.message});
    }
  });
  c.on('console-message',(_event,level,message)=>{if(level>=2)log('renderer-console',{id:c.id,level,message});});
  c.on('destroyed',()=>clients.delete(c));
});
log('host-ready',{electron:process.versions.electron,chrome:process.versions.chrome,root});
