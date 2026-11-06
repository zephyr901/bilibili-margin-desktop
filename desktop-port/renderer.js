(async () => {
  if (window.marginDesktopRuntime) return;
  const api = window.marginDesktop;
  if (!api) throw Error('MARGIN scoped preload unavailable');

  const adapter = await import('margin://app/adapter.js');
  const {createNativeSearchSkin} = await import('margin://app/native-search.js');
  const {createAuthSync} = await import('margin://app/auth-sync.js');
  const raw = await api.storageGet('margin:settings');
  if (!raw['margin:settings']) await api.storageSet({'margin:settings': {theme: 'light'}});
  let settings = await adapter.loadSettings();
  const de = document.documentElement;
  const themeQuery = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => settings.theme === 'auto' ? (themeQuery.matches ? 'dark' : 'light') : settings.theme;
  const native = (method, payload) => payload === undefined
    ? window.biliBridgePc.callNative(method)
    : window.biliBridgePc.callNative(method, payload);
  const report = error => api.log('mount-error', {message: String(error)});

  function applyFont(s) {
    const custom = s.enabled && s.bodyFont ? '"' + s.bodyFont + '", ' : '';
    const sans = custom + '"Geist", "Margin Sans SC", "Microsoft YaHei", system-ui, sans-serif';
    const set = (name, value) => value ? de.style.setProperty(name, value) : de.style.removeProperty(name);
    set('--margin-sans', custom ? sans : null);
    set('--margin-title', s.enabled && s.titleFont === 'sans' ? sans : null);
    set('--margin-mono', s.enabled && !s.monoNum ? sans : null);
    set('--margin-zoom', s.enabled && s.zoom !== 100 ? String(s.zoom / 100) : null);
    set('--margin-rk', s.enabled && s.radius !== 100 ? String(s.radius / 100) : null);
    set('--margin-cfs', s.enabled && s.commentSize !== 14 ? s.commentSize + 'px' : null);
    if (s.enabled && s.cdn) localStorage.setItem('margin:cdn', s.cdn);
    else localStorage.removeItem('margin:cdn');
  }
  applyFont(settings);
  adapter.injectFonts();
  adapter.setUserReducedMotion(settings.reduceMotion);
  adapter.startTracking();
  const searchSkin = createNativeSearchSkin();

  const bar = document.createElement('div');
  bar.id = 'margin-desktop-controls';
  bar.style.cssText = 'position:fixed;inset:0 0 auto;height:32px;z-index:2147483647;display:flex;align-items:stretch;padding-left:14px;font:12px "Geist",sans-serif;-webkit-app-region:drag;border-bottom:1px solid #8882';
  bar.innerHTML = '<span style="flex:1;align-self:center">MARGIN · 哔哩哔哩客户端</span><button data-action="home">映间首页</button><button data-action="native">原生界面</button><button data-action="minimize" aria-label="最小化">—</button><button data-action="toggleMaximize" aria-label="最大化或还原">□</button><button data-action="close" aria-label="关闭">×</button>';
  for (const button of bar.querySelectorAll('button')) {
    button.style.cssText = '-webkit-app-region:no-drag;border:0;padding:0 12px;color:inherit;background:transparent;cursor:pointer';
  }
  de.append(bar);

  const nativeStyle = document.createElement('style');
  nativeStyle.textContent = [
    'html.margin-desktop-native body { padding-top: 32px !important; }',
    'html.margin-desktop-home #app :is(.draggable,.skeleton-header,.skeleton-sidebar),',
    'html.margin-desktop-search #app :is(.draggable,.skeleton-header,.skeleton-sidebar) { -webkit-app-region: none !important; }',
    '.base_popup--wrap:has(.privacy_policy_dialog) { z-index: 2147483647 !important; position: fixed !important; }',
  ].join('\n');
  document.head.append(nativeStyle);

  let home, loadingHome;
  const authSync = createAuthSync({
    getBridge: () => window.biliBridgePc,
    readRendered: () => {
      const user = home?.host.shadowRoot.querySelector('.top .user');
      if (!user) return null;
      const isLogin = user.classList.contains('in');
      return {isLogin, mid: isLogin ? Number(new URL(user.href).pathname.split('/')[1]) : 0,
        cacheStale: isLogin && !!home?.fav?.body.querySelector('.shelf a.user')};
    },
    readNav: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw Error('Account state HTTP ' + response.status);
        return (await response.json()).data;
      } finally { clearTimeout(timer); }
    },
    refresh: () => { api.log('auth-ui-refresh', {reason: 'verified-account-change'}); return api.refreshAccount(); },
    storage: sessionStorage,
    isVisible: () => !document.hidden,
    onError: error => api.log('auth-sync-error', {message: String(error.message || error)}),
  });
  authSync.start();
  const authReady = authSync.prepare();
  addEventListener('focus', () => authSync.check());
  document.addEventListener('visibilitychange', () => authSync.check());
  addEventListener('pagehide', () => authSync.stop(), {once: true});
  let nativeOnly = !!sessionStorage.getItem('margin:off');
  let view = 'native';
  const isSearchRoute = () => /^#\/page\/search-page(?:[/?]|$)/.test(location.hash);

  function ensureHome() {
    if (!loadingHome) {
      loadingHome = authReady.then(() => import('margin://app/pages/home.js')).then(({MarginApp}) => {
        home = new MarginApp(settings);
        home.host.dataset.marginDesktop = 'true';
        const style = document.createElement('style');
        style.textContent = [
          '.app { top:32px !important; height:calc(100vh - 32px) !important; }',
          '.sheet { top:42px !important; height:calc(100vh - 52px) !important; }',
          ':host([data-desktop-view="search"]) .app { background:transparent; pointer-events:none; overflow:visible; }',
          ':host([data-desktop-view="search"]) .app > :is(.bg,.main,.intro) { display:none !important; }',
          ':host([data-desktop-view="search"]) .app > :is(.top,.cp,.dw,.cm,.sheet-layer[data-open="true"]) { pointer-events:auto; }',
          ':host([data-desktop-view="search"]) .app > .top { height:72px; background:var(--canvas); }',
          ':host([data-desktop-view="search"]) .top .search { visibility:hidden; pointer-events:none; }',
        ].join('\n');
        home.host.shadowRoot.append(style);
        de.append(home.host);
        runtime.app = runtime.current = home;
        authSync.mounted();
        return home;
      }).catch(error => { loadingHome = null; throw error; });
    }
    return loadingHome;
  }

  function setView(next) {
    if (view === 'search' && next !== 'search') searchSkin.stop();
    view = next;
    for (const name of ['home', 'native', 'search']) de.classList.toggle('margin-desktop-' + name, next === name);
    if (home) {
      home.host.style.display = next === 'native' ? 'none' : '';
      home.host.dataset.desktopView = next;
    }
    if (next === 'search') searchSkin.update(theme(), settings);
    runtime.view = next;
  }

  async function syncRoute() {
    if (nativeOnly || !settings.enabled || (isSearchRoute() && !settings.watch)) {
      setView('native');
      return;
    }
    await ensureHome();
    if (nativeOnly || !settings.enabled) { setView('native'); return; }
    const next = isSearchRoute() ? (settings.watch ? 'search' : 'native') : 'home';
    setView(next);
  }

  const runtime = {
    settings, adapter, view, app: null, current: null,
    asset: p => chrome.runtime.getURL(p),
    originalOpen: window.marginDesktopGuest.originalOpen,
    async mountHome() {
      nativeOnly = false;
      sessionStorage.removeItem('margin:off');
      if (!settings.enabled) { setView('native'); return; }
      await ensureHome();
      setView('home');
      if (isSearchRoute()) {
        const homeLink = document.querySelector('.app_sidebar a[href$="#/page/home"]');
        if (homeLink) homeLink.click();
        else await native('window/openMainWindowPage', {page: 'RecommendPage'});
      }
      return home;
    },
    async openNativeSearch(payload) {
      if (payload.page === 'SearchFocus' && settings.enabled && !nativeOnly && !isSearchRoute()) {
        await ensureHome();
        const input = home.host.shadowRoot.querySelector('.hs-input');
        if (input?.getClientRects().length) { input.focus(); return; }
      }
      // Use the native form, including its search history and result categories.
      // The window-to-window search message may be dropped while focus is changing.
      if (payload.page === 'SearchPage') {
        const form = document.querySelector('.header_search--input');
        const input = form?.querySelector('input');
        const submit = form?.querySelector('.search-icon');
        if (input && submit) {
          input.value = payload.meta.keyword;
          input.dispatchEvent(new Event('input', {bubbles: true}));
          submit.click();
          return;
        }
      }
      await native('window/openMainWindowPage', payload);
    },
    nativeFallback() {
      nativeOnly = true;
      setView('native');
    },
    open(value) { return api.open(new URL(String(value), 'https://www.bilibili.com/').href); },
  };
  window.marginDesktopRuntime = runtime;
  bar.addEventListener('click', async event => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    try {
      if (action === 'home') {
        if (!settings.enabled) settings = await adapter.saveSettings({enabled: true});
        await runtime.mountHome();
      } else if (action === 'native') runtime.nativeFallback();
      else await native('window/' + action);
    } catch (error) { report(error); }
  });

  let observedHash = location.hash;
  let observedFrame = document.getElementById('appSearchFrame');
  const onRoute = () => {
    const frame = document.getElementById('appSearchFrame');
    if (observedHash === location.hash && observedFrame === frame) return;
    observedHash = location.hash;
    observedFrame = frame;
    syncRoute().catch(report);
  };
  // The client's Vue hash router can use history.pushState, which does not emit hashchange.
  new MutationObserver(onRoute).observe(document.getElementById('app') ?? document.body, {childList: true, subtree: true});
  addEventListener('hashchange', onRoute);
  addEventListener('popstate', onRoute);
  const paintBar = () => {
    const dark = theme() === 'dark';
    bar.style.background = dark ? '#111112' : '#f5f4f1';
    bar.style.color = dark ? '#ededee' : '#17181a';
    if (view === 'search') searchSkin.update(theme(), settings);
  };
  adapter.onSettingsChange(next => {
    settings = runtime.settings = next;
    applyFont(next);
    adapter.setUserReducedMotion(next.reduceMotion);
    home?.update(next);
    paintBar();
    syncRoute().catch(report);
  });
  themeQuery.addEventListener('change', paintBar);
  await authReady;
  await syncRoute();
  paintBar();
  api.log('home-mounted', {theme: settings.theme, view, upstream: '0.52.0', nativeBridge: !!window.biliBridgePc});
  return {ready: true, theme: settings.theme};
})().catch(error => {
  console.error('[MARGIN desktop]', error);
  window.marginDesktop?.log('mount-error', {message: error.message, stack: error.stack});
  throw error;
});
