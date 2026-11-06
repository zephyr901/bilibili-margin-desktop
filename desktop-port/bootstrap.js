/* Runs in MAIN at preload time. No Node bridge, native-guard, or website entry on native shells. */
(()=>{
  if(window.marginDesktopBooted)return;
  window.marginDesktopBooted=true;
  const api=window.marginDesktop;
  // Chromium 108 lacks this on ordinary website origins; native index supplies its own polyfill.
  if(!Object.getOwnPropertyDescriptor(URLSearchParams.prototype,'size'))Object.defineProperty(URLSearchParams.prototype,'size',{configurable:true,get(){let n=0;this.forEach(()=>n++);return n;}});
  const changes=new Set(),chrome=window.chrome||{};
  chrome.storage={local:{get:k=>api.storageGet(k),set:v=>api.storageSet(v),remove:k=>api.storageRemove(k)},onChanged:{addListener:fn=>changes.add(fn),removeListener:fn=>changes.delete(fn)}};
  chrome.runtime={getURL:p=>'margin://app/'+String(p).replace(/^\//,''),getManifest:()=>({version:'0.52.0',name:'映间 MARGIN'}),sendMessage:(m,callback)=>{const result=api.sendMessage(m);if(callback)result.then(callback);return result;},lastError:undefined};
  window.chrome=chrome;
  api.onStorageChange((c,area)=>{for(const fn of changes)try{fn(c,area);}catch(e){console.error('[MARGIN storage]',e);}});
  const original=window.open.bind(window);
  const navigate=url=>api.open(new URL(String(url),location.href).href).catch(e=>{console.error('[MARGIN navigation]',e);alert('无法打开链接：'+e.message);});
  window.open=(url,target,features)=>{if(url&&/^(https?:)?\/\//.test(String(url))){navigate(url);return null;}return original(url,target,features);};
  document.addEventListener('click',e=>{if(e.button!==0)return;const link=e.composedPath().find(x=>x instanceof HTMLAnchorElement);if(!link||link.download||!/^https?:/.test(link.href))return;if(location.hostname==='bilipc.bilibili.com'&&link.origin===location.origin)return;try{window.marginRoutes.classifyRoute(link.href);}catch{return;}e.preventDefault();e.stopImmediatePropagation();navigate(link.href);},true);
  window.marginDesktopGuest={startedAt:performance.now(),readyState:document.readyState,url:location.href,size:new URLSearchParams('a=1&b=2').size,open:navigate,originalOpen:original};
  api.log('preload-main',{readyState:document.readyState,hasRoot:!!document.documentElement,size:window.marginDesktopGuest.size});
  // Upstream nav()/WBI caches are document-scoped. Native login/logout updates
  // the shared experimental session; reload after its actual state notification.
  const authSync=()=>{
    if(!window.biliBridgePc?.addListener)return;
    let pending;
    const refresh=reason=>{clearTimeout(pending);pending=setTimeout(()=>{api.log('auth-ui-refresh',{reason});location.reload();},300);};
    window.biliBridgePc.addListener('auth/userLoginChange',event=>{if(typeof event?.data==='boolean')refresh(event.data?'login':'logout');});
    window.biliBridgePc.addListener('auth/userInfoChange',()=>refresh('profile'));
  };
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',authSync,{once:true});else authSync();
})();
