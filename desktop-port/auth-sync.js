// Reconcile the native account with the account actually rendered by MARGIN.
// No credentials are read or copied. A verified identity change resets the
// upstream document-scoped nav and favorites caches together.
export function createAuthSync({
  getBridge, readNav, readRendered, refresh, storage,
  now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  setTimer = setTimeout, clearTimer = clearTimeout, isVisible = () => true,
  onError = () => {}, nativeTimeout = 1500,
}) {
  const attemptKey = 'margin:auth-refresh-attempt';
  let disposed = false, started = false, refreshed = false, timer, busy;
  let mountedAt = null, subscribedBridge;
  const removers = [];
  const identity = value => {
    if (value?.isLogin === false) return 'guest';
    if (value?.isLogin === true && Number(value.mid) > 0) return 'user:' + String(value.mid);
    return null;
  };
  const nativeIdentity = async () => {
    let timeout;
    try {
      const bridge = getBridge();
      if (!bridge?.callNative) return null;
      // sendSync hangs the renderer if the official auth service has not yet
      // registered its channel. An async query can safely time out and retry.
      const value = await Promise.race([
        bridge.callNative('auth/getUserInfo'),
        new Promise(resolve => {timeout = setTimer(() => resolve(null), nativeTimeout);}),
      ]);
      // Native async replies wrap the snapshot in {data}; the synchronous
      // variant used by the official Vue store returns the snapshot directly.
      return identity(value?.data ?? value);
    } catch { return null; }
    finally { clearTimer(timeout); }
  };
  const matches = (state, key) => identity(state) === key && !state.cacheStale;
  const storedAttempt = () => { try { return storage?.getItem(attemptKey); } catch { return null; } };
  const clearAttempt = key => { try { if (storedAttempt() === key) storage?.removeItem(attemptKey); } catch {} };

  function subscribe() {
    const bridge = getBridge();
    if (!bridge?.addListener || bridge === subscribedBridge) return;
    for (const remove of removers.splice(0)) remove();
    try {
      for (const name of ['auth/userLoginChange', 'auth/userInfoChange']) {
        // Notifications carry different payloads across native versions. Read
        // the current snapshot instead of guessing from event.data's type.
        const remove = bridge.addListener(name, () => schedule(100));
        if (typeof remove === 'function') removers.push(remove);
      }
      subscribedBridge = bridge;
    } catch (error) {
      for (const remove of removers.splice(0)) remove();
      onError(error);
    }
  }

  function schedule(ms = 1500) {
    if (disposed || !started || refreshed) return;
    clearTimer(timer);
    timer = setTimer(async () => {
      timer = undefined;
      try { await check(); } catch (error) { onError(error); }
      schedule();
    }, ms);
  }

  async function prepare() {
    subscribe();
    const deadline = now() + 5000;
    // The native client restores its session asynchronously on cold launch.
    // Do not initialize upstream's permanent guest nav cache while the native
    // account is already known to be signed in but its web session is pending.
    for (let attempt = 0; attempt < 6 && !disposed; attempt++) {
      const before = await nativeIdentity();
      let web;
      try { web = identity(await readNav()); } catch (error) { onError(error); }
      const after = await nativeIdentity();
      if ((after && before === after && after === web) || now() >= deadline || attempt === 5) return;
      await delay(200 + attempt * 150);
    }
  }

  async function reconcile() {
    subscribe();
    if (disposed || refreshed || !isVisible() || mountedAt === null || now() - mountedAt < 1000) return;
    const native = await nativeIdentity(), rendered = readRendered();
    if (disposed || !native || !identity(rendered)) return;
    if (matches(rendered, native)) { clearAttempt(native); return; }
    if (storedAttempt() === native) return;
    const web = identity(await readNav());
    const current = await nativeIdentity();
    if (disposed || refreshed || current !== native || web !== native) return;
    // The original header request may have completed while we were checking.
    if (matches(readRendered(), native)) { clearAttempt(native); return; }
    try { storage?.setItem(attemptKey, native); } catch {}
    refreshed = true;
    clearTimer(timer);
    try { await refresh(); }
    catch (error) {
      refreshed = false;
      clearAttempt(native);
      onError(error);
      schedule();
    }
  }

  function check() {
    if (busy) return busy;
    busy = reconcile().catch(onError).finally(() => { busy = null; });
    return busy;
  }

  return {
    prepare, check,
    mounted() { mountedAt ??= now(); schedule(1000); },
    start() { if (disposed || started) return; started = true; subscribe(); schedule(); },
    stop() {
      disposed = true;
      clearTimer(timer);
      for (const remove of removers.splice(0)) remove();
    },
  };
}
