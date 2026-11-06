'use strict';
const {contextBridge,ipcRenderer,webFrame}=require('electron');
// Session preloads also execute in unrelated pages. Never expose privileged IPC
// to local files, iframes, or unrelated websites. The host additionally verifies
// exact top-level webContents identity before issuing the bootstrap.
function bootstrap() {
  const page = new URL(location.href);
  const native = page.origin === 'https://bilipc.bilibili.com' && /^\/(index|player|search)\.html$/.test(page.pathname);
  const ordinary = page.protocol === 'https:' && !page.port && /^(www|space|t|message|search)\.bilibili\.com$/.test(page.hostname);
  if (page.username || page.password || !(native || ordinary)) return false;
  const permit = ipcRenderer.sendSync('margin:bootstrap');
  if (!permit) return false;
  contextBridge.exposeInMainWorld('marginDesktop',{
    storageGet:keys=>ipcRenderer.invoke('margin:storageGet',keys),
    storageSet:values=>ipcRenderer.invoke('margin:storageSet',values),
    storageRemove:keys=>ipcRenderer.invoke('margin:storageRemove',keys),
    sendMessage:message=>ipcRenderer.invoke('margin:message',message),
    fetch:(url,init)=>ipcRenderer.invoke('margin:fetch',url,init),
    open:url=>ipcRenderer.invoke('margin:open',url),
    onStorageChange:callback=>{const listener=(_event,changes)=>callback(changes,'local');ipcRenderer.on('margin:storageChanged',listener);return()=>ipcRenderer.removeListener('margin:storageChanged',listener);},
    log:(event,detail)=>ipcRenderer.send('margin:log',event,detail)
  });
  webFrame.executeJavaScript(permit.source).catch(error=>ipcRenderer.send('margin:log','bootstrap-error',{message:error.message,stack:error.stack}));
  return true;
}
if (process.isMainFrame !== false && !bootstrap()) {
  // A reused BrowserView can run its preload before the main process sees
  // the committed URL. Retry with the same sender checks after that navigation.
  window.addEventListener('DOMContentLoaded', bootstrap, {once: true});
}
