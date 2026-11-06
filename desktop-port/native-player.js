/* Dedicated native player adapter. Website entry/native-guard never execute here. */
(()=>{
  if(window.marginNativePlayer)return;
  const api=window.marginDesktop,de=document.documentElement;
  let settings={enabled:true,watch:true,speedKeys:true,commentSize:14},remembered=1;
  let mode='normal',skin=null,toolbar=null,nativeFull=false;
  const native=(method,payload)=>payload===undefined
    ? window.biliBridgePc.callNative(method)
    : window.biliBridgePc.callNative(method,payload);
  const miniLayout=()=>!!document.querySelector('.app_player.screen_mini');
  const smallViewport=()=>innerWidth<=820||innerHeight<=460;
  const nativeMini=()=>window.biliBridgePc.callNativeSync('window/isMiniPlayerMode')===true;
  const playerError=error=>api.log('native-player-control-error',{message:String(error)});
  async function settleMiniTransition() {
    // The native button changes the DOM before its delayed window resize runs.
    for (let i=0;i<10&&miniLayout()&&!smallViewport()&&!nativeMini();i++) {
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  let restoring;
  function restoreMini() {
    if (!restoring) restoring = (async () => {
      await settleMiniTransition();
      if (nativeMini()) {
        await native('window/unminiPlayerWindow');
        await native('window/unpinPlayerWindow');
      }
      if (smallViewport()) await native('window/stretchPlayerWindow');
    })().finally(() => { restoring = null; });
    return restoring;
  }
  const editable=event=>event.composedPath().some(n=>n instanceof HTMLElement&&(n.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)));
  const speed=key=>{
    const p=window.biliPlayer;if(!p?.getPlaybackRate||!p?.setPlaybackRate)return null;
    const next=window.marginPlayerModel.nextSpeed(key,Number(p.getPlaybackRate())||1,remembered);
    remembered=next.remembered;p.setPlaybackRate(next.rate);
    const out=toolbar?.querySelector('output');if(out)out.textContent=next.rate.toFixed(1)+'×';return next.rate;
  };
  // Capture on Window before the official document X/C shortcuts run.
  addEventListener('keydown',event=>{
    if(!settings.enabled||!settings.watch||sessionStorage.getItem('margin:off')||!settings.speedKeys||event.ctrlKey||event.metaKey||event.altKey||editable(event))return;
    const key=event.key.toLowerCase();if(!['x','c','z'].includes(key)||event.repeat&&key==='z'||!window.biliPlayer?.setPlaybackRate)return;
    event.preventDefault();event.stopImmediatePropagation();speed(key);
  },true);
  const setMode=value=>{
    mode=value;de.dataset.marginPlayerLayout=mode;
    de.classList.toggle('margin-native-scroll',mode==='web'&&settings.webScroll);
    if(skin)skin.host.hidden=mode==='web'||nativeFull;
    toolbar?.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    window.dispatchEvent(new Event('resize'));return mode;
  };
  const state={mode:()=>mode,speed,setMode,settings:()=>settings,
    fullscreen:async on=>{if(on)await native('window/oneTimeFullScreen');await native('window/setFullScreen',!!on);const actual=await native('window/isFullScreen');nativeFull=!!actual?.data;de.classList.toggle('margin-native-full',nativeFull);if(skin)skin.host.hidden=nativeFull||mode==='web';return nativeFull;},
    status:()=>({mode,nativeFull,rate:window.biliPlayer?.getPlaybackRate?.(),cdn:localStorage.getItem('margin:cdn')||'',comments:document.querySelectorAll('bili-comments').length})};
  window.marginNativePlayer=state;
  (async()=>{
    const adapter=await import('margin://app/adapter.js');settings=await adapter.loadSettings();
    const off=()=>!settings.enabled||!settings.watch||!!sessionStorage.getItem('margin:off');
    if(off()){
      if(sessionStorage.getItem('margin:off')){const back=document.createElement('button');back.textContent='返回 MARGIN';back.style.cssText='position:fixed;left:16px;top:52px;z-index:99999;padding:8px 16px;border-radius:20px;cursor:pointer';back.onclick=()=>{sessionStorage.removeItem('margin:off');location.reload();};de.append(back);}
      adapter.onSettingsChange(next=>{if(next.enabled&&next.watch)location.reload();});return;
    }
    adapter.injectFonts();adapter.startTracking();
    const palette=document.createElement('link');palette.rel='stylesheet';palette.href='margin://app/native-palette.css';de.append(palette);
    const styles=document.createElement('link');styles.rel='stylesheet';styles.href='margin://app/native-player.css';de.append(styles);
    const {WatchSkin}=await import('margin://app/pages/watch.js');
    // All original header/settings/favorites/command/background modules stay intact.
    class NativeSkin extends WatchSkin{watchScreen(){}}
    skin=new NativeSkin(settings,'page');
    const scope=document.createElement('style');scope.textContent='.app.wt{top:48px!important;height:72px!important}.sheet{top:128px!important;height:calc(100vh - 144px)!important}';skin.host.shadowRoot.append(scope);
    const {skinCommentHost}=await import('margin://app/adapter/content/ui/comment-skin.js');
    const {watchCommentTree}=await import('margin://app/native-comment-tree.js');
    const setReplyTree=watchCommentTree(window.marginPlayerModel.replyLayout,skinCommentHost);
    const {startNativeFilter}=await import('margin://app/adapter/content/native-filter.js');
    startNativeFilter('watch',settings,document,[{
      root:'.app_video--rec',item:'.app_video--rec-card',title:'.bili-video-card__info--tit',
      author:'.bili-video-card__info--author',views:'.bili-video-card__stats--item:first-child',
      duration:'.bili-video-card__stats__duration',ad:'.bili-video-card__info--ad, .bili-video-card__stats__ad-icon',
    }]);
    const {observeNativeTriple}=await import('margin://app/adapter/content/ui/triple.js');
    observeNativeTriple();
    toolbar=document.createElement('nav');toolbar.id='margin-native-actions';toolbar.setAttribute('aria-label','MARGIN 原生播放器操作');
    toolbar.innerHTML='<button data-mode="normal">默认布局</button><button data-mode="wide">宽屏</button><button data-mode="web">窗口内全屏</button><button data-action="comments">看评论</button><span class="spacer"></span><button data-speed="x" title="X：减速 0.1×">−</button><output>1.0×</output><button data-speed="c" title="C：加速 0.1×">＋</button><button data-speed="z" title="Z：恢复/切换倍速">重置倍速</button><button data-action="fullscreen">系统全屏</button><button data-action="native">原生界面</button>';
    de.append(toolbar);
    const miniActions=document.createElement('nav');
    miniActions.id='margin-native-mini-actions';
    miniActions.setAttribute('aria-label','小窗播放');
    miniActions.innerHTML='<button type="button" data-restore title="还原播放器（Esc）">还原</button><button type="button" aria-label="关闭播放器">关闭</button>';
    miniActions.querySelector('[data-restore]').onclick=()=>restoreMini().catch(playerError);
    miniActions.querySelector('[aria-label="关闭播放器"]').onclick=()=>settleMiniTransition().then(()=>native('window/close')).catch(playerError);
    de.append(miniActions);
    function labelMiniButton() {
      const button = document.querySelector('.app_player--header-icon:has(.icon-mini)');
      if (!button) return false;
      button.title='小窗播放';
      return true;
    }
    if (!labelMiniButton()) {
      const observer = new MutationObserver(() => { if (labelMiniButton()) observer.disconnect(); });
      observer.observe(de,{childList:true,subtree:true});
    }
    document.addEventListener('ratechange',()=>{const rate=window.biliPlayer?.getPlaybackRate?.();if(Number.isFinite(rate))toolbar.querySelector('output').textContent=rate.toFixed(1)+'×';},true);
    const showComments=()=>{
      if(mode==='wide')setMode('normal');
      const tabs=[...document.querySelectorAll('.app_player--right button,.app_player--right [class*="tab"]')];
      const tab=tabs.find(e=>/^评论\s*\d*$/.test(e.textContent.trim())&&e.children.length<4);tab?.click();
      document.querySelector('.app_video--comment')?.scrollIntoView({behavior:'smooth',block:'start'});
    };
    state.showComments=showComments;
    toolbar.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.mode){setMode(mode===button.dataset.mode?'normal':button.dataset.mode);return;}
      if(button.dataset.speed){speed(button.dataset.speed);return;}
      if(button.dataset.action==='comments')showComments();
      if(button.dataset.action==='fullscreen')state.fullscreen(!nativeFull);
      if(button.dataset.action==='native'){sessionStorage.setItem('margin:off','1');location.reload();}
    });
    const media=matchMedia('(prefers-color-scheme:dark)');
    const apply=next=>{
      const previous=settings;settings=next;
      if(!settings.enabled||!settings.watch){location.reload();return;}
      de.classList.add('margin-native-themed');
      de.dataset.marginTheme=settings.theme==='auto'?(media.matches?'dark':'light'):settings.theme;
      const sans=(settings.bodyFont?`"${settings.bodyFont}", `:'')+'"Geist", "Margin Sans SC", "Microsoft YaHei", sans-serif';
      const set=(k,v)=>v===null?de.style.removeProperty(k):de.style.setProperty(k,v);
      set('--margin-sans',settings.bodyFont?sans:null);set('--margin-title',settings.titleFont==='sans'?sans:null);set('--margin-mono',!settings.monoNum?sans:null);
      set('--margin-rk',String(settings.radius/100));set('--margin-cfs',settings.commentSize+'px');set('--bili-comments-font-size-content',settings.commentSize+'px');
      set('--margin-zoom',String(settings.zoom/100));adapter.setUserReducedMotion(settings.reduceMotion);
      if (previous.replyTree !== settings.replyTree) setReplyTree(settings.replyTree);
      if(settings.cdn)localStorage.setItem('margin:cdn',settings.cdn);else localStorage.removeItem('margin:cdn');
      skin.update(settings);
      if(previous.autoWeb!==settings.autoWeb||previous.wide!==settings.wide)setMode(settings.autoWeb?'web':settings.wide?'wide':'normal');else setMode(mode);
      // The original MAIN-world CDN hook captures its selected host at document start.
      // A native player is reused across videos, so reload it on this setting change.
      if(previous.cdn!==settings.cdn)location.reload();
    };
    setReplyTree(settings.replyTree);
    state.apply=apply;apply(settings);setMode(settings.autoWeb?'web':settings.wide?'wide':'normal');
    adapter.onSettingsChange(apply);media.addEventListener('change',()=>apply(settings));
    window.biliBridgePc.addListener?.('window/fullScreenChange',event=>{nativeFull=!!(event?.data??event);de.classList.toggle('margin-native-full',nativeFull);skin.host.hidden=nativeFull||mode==='web';});
    addEventListener('keydown',event=>{
      if (editable(event)||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey) return;
      if (event.key.toLowerCase()==='s') {
        // A stray keypress must not collapse the player. The mini button is explicit.
        event.preventDefault();event.stopImmediatePropagation();
        if (miniLayout()&&!event.repeat) restoreMini().catch(playerError);
      } else if (event.key==='Escape') {
        if (miniLayout()) restoreMini().catch(playerError);
        else if (mode!=='normal') setMode('normal');
      }
    },true);
    let recoveryTimer, triedCompactRecovery=false;
    function checkCompactWindow() {
      clearTimeout(recoveryTimer);
      if (!smallViewport()) { triedCompactRecovery=false; return; }
      if (triedCompactRecovery || screen.availWidth<=840 || screen.availHeight<=480) return;
      recoveryTimer=setTimeout(()=>{
        // Also recover bounds persisted by an older build, or changed by Windows snap.
        if (!miniLayout()||nativeMini()) return;
        triedCompactRecovery=true;
        restoreMini().catch(playerError);
      },250);
    }
    addEventListener('resize',checkCompactWindow);
    checkCompactWindow();
    api.log('native-player-mounted',{theme:de.dataset.marginTheme,mode,upstream:'WatchSkin/page + native layout',cdn:settings.cdn||'default'});
  })().catch(error=>{console.error('[MARGIN native player]',error);api.log('native-player-error',{message:error.message,stack:error.stack});});
})();
