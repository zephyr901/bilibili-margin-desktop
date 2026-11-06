'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../desktop-port/auth-sync.js'), 'utf8');
const load = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const guest = () => ({isLogin: false});
const member = mid => ({isLogin: true, mid});
function fixture(createAuthSync, options = {}) {
  let native = guest(), rendered = guest(), web = guest(), clock = 0;
  const listeners = new Map(), timers = new Map(), values = new Map();
  let serial = 0, refreshes = 0, requests = 0, removed = 0, delays = 0;
  const storage = {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k)};
  const bridge = {callNative: async () => ({data: native}), callNativeSync: () => {throw Error('A synchronous auth call can hang cold launch');},
    addListener(name, fn) {listeners.set(name, fn); return () => {listeners.delete(name); removed++;};}};
  const sync = createAuthSync({
    getBridge: () => bridge,
    readRendered: () => rendered,
    readNav: async () => {requests++; return web;},
    refresh: () => {refreshes++;}, storage,
    now: () => clock,
    delay: async () => {delays++;},
    setTimer: (fn, ms) => {timers.set(++serial, {fn, ms}); return serial;},
    clearTimer: id => timers.delete(id),
    ...options,
  });
  sync.mounted(); clock = 2000;
  return {sync, bridge, storage, listeners, timers, values,
    state(n, r, w) {native = n; rendered = r; web = w;},
    get counts() {return {refreshes, requests, removed, delays};},
    async tick() {const next = timers.entries().next().value; if (next) {timers.delete(next[0]); clock += next[1].ms; await next[1].fn();}},
  };
}

test('startup waits for the web session to catch up with the native account', async () => {
  const {createAuthSync} = await load;
  let reads = 0;
  const f = fixture(createAuthSync, {readNav: async () => ++reads === 1 ? guest() : member(42)});
  f.state(member(42), guest(), member(42));
  await f.sync.prepare();
  assert.equal(reads, 2);
  assert.equal(f.counts.delays, 1);
  assert.equal(f.counts.refreshes, 0);
});

test('a native auth channel that has not registered cannot block the page', async () => {
  const {createAuthSync} = await load;
  let syncCalls = 0;
  const f = fixture(createAuthSync, {getBridge: () => ({callNative: () => new Promise(() => {}), callNativeSync: () => {syncCalls++;}}),
    nativeTimeout: 10, setTimer: setTimeout, clearTimer: clearTimeout});
  await f.sync.check();
  assert.equal(syncCalls, 0);
  assert.equal(f.counts.refreshes, 0);
});

test('one transient startup request failure does not open the account gate early', async () => {
  const {createAuthSync} = await load;
  let reads = 0;
  const f = fixture(createAuthSync, {readNav: async () => {if (++reads === 1) throw Error('transient'); return member(42);}});
  f.state(member(42), guest(), member(42));
  await f.sync.prepare();
  assert.equal(reads, 2);
  assert.equal(f.counts.delays, 1);
});

test('a missed login notification repairs a guest header and its stale favorites cache once', async () => {
  const {createAuthSync} = await load;
  const f = fixture(createAuthSync);
  await f.sync.prepare();
  f.state(member(42), guest(), member(42));
  await f.sync.check();
  await f.sync.check();
  assert.equal(f.counts.refreshes, 1);
});

test('an unchanged signed-in header makes no reconciliation network requests', async () => {
  const {createAuthSync} = await load;
  const f = fixture(createAuthSync);
  f.state(member(42), member(42), member(42));
  await f.sync.check();
  assert.equal(f.counts.requests, 0);
  assert.equal(f.counts.refreshes, 0);
});

test('a signed-in header cannot hide a guest favorites cache', async () => {
  const {createAuthSync} = await load;
  const f = fixture(createAuthSync);
  f.state(member(42), {...member(42), cacheStale: true}, member(42));
  await f.sync.check();
  assert.equal(f.counts.refreshes, 1);
});

test('logout and account switches reset the prior account document after web auth agrees', async () => {
  const {createAuthSync} = await load;
  for (const next of [guest(), member(99)]) {
    const f = fixture(createAuthSync);
    f.state(next, member(42), next);
    await f.sync.check();
    assert.equal(f.counts.refreshes, 1);
  }
});

test('a native login does not reload into a web session that is still anonymous', async () => {
  const {createAuthSync} = await load;
  const f = fixture(createAuthSync);
  f.state(member(42), guest(), guest());
  await f.sync.check();
  assert.equal(f.counts.refreshes, 0);
  f.state(member(42), guest(), member(42));
  await f.sync.check();
  assert.equal(f.counts.refreshes, 1);
});

test('the result from an old account cannot refresh a later account transition', async () => {
  const {createAuthSync} = await load;
  let finish;
  const f = fixture(createAuthSync, {readNav: () => new Promise(resolve => {finish = resolve;})});
  f.state(member(42), guest(), member(42));
  const pending = f.sync.check();
  await new Promise(resolve => setImmediate(resolve));
  f.state(member(99), guest(), member(99));
  finish(member(42));
  await pending;
  assert.equal(f.counts.refreshes, 0);
});

test('profile notifications are deduplicated and all listeners and timers are released', async () => {
  const {createAuthSync} = await load;
  const f = fixture(createAuthSync);
  f.state(member(42), member(42), member(42));
  f.sync.start(); f.sync.start();
  assert.equal(f.listeners.size, 2);
  f.listeners.get('auth/userInfoChange')({data: {isLogin: true}});
  f.listeners.get('auth/userInfoChange')({data: {isLogin: true}});
  await f.tick();
  assert.equal(f.counts.refreshes, 0);
  assert.equal(f.timers.size, 1);
  f.sync.stop();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.counts.removed, 2);
});

test('stopping while a nav request is pending prevents a late refresh', async () => {
  const {createAuthSync} = await load;
  let finish;
  const f = fixture(createAuthSync, {readNav: () => new Promise(resolve => {finish = resolve;})});
  f.state(member(42), guest(), member(42));
  const pending = f.sync.check();
  await new Promise(resolve => setImmediate(resolve));
  f.sync.stop(); finish(member(42));
  await pending;
  assert.equal(f.counts.refreshes, 0);
});

test('a persistent rendering error cannot cause an automatic reload loop across documents', async () => {
  const {createAuthSync} = await load;
  const first = fixture(createAuthSync);
  first.state(member(42), guest(), member(42));
  await first.sync.check();
  const next = fixture(createAuthSync, {storage: first.storage});
  next.state(guest(), guest(), guest());
  await next.sync.check();
  assert.equal(first.values.size, 1, 'a transient guest snapshot must not erase another identity reload guard');
  next.state(member(42), guest(), member(42));
  await next.sync.check();
  assert.equal(first.counts.refreshes, 1);
  assert.equal(next.counts.refreshes, 0);
  next.state(member(42), member(42), member(42));
  await next.sync.check();
  assert.equal(first.values.size, 0);
});

test('a bridge arriving late still registers notifications and repairs the account', async () => {
  const {createAuthSync} = await load;
  let bridge = null;
  const f = fixture(createAuthSync, {getBridge: () => bridge});
  f.sync.start();
  assert.equal(f.listeners.size, 0);
  bridge = f.bridge;
  f.state(member(42), guest(), member(42));
  await f.sync.check();
  assert.equal(f.listeners.size, 2);
  assert.equal(f.counts.refreshes, 1);
  f.sync.stop();
});

test('a rejected native refresh can retry without leaving a permanent reload guard', async () => {
  const {createAuthSync} = await load;
  let attempts = 0;
  const f = fixture(createAuthSync, {refresh: async () => {if (++attempts === 1) throw Error('temporarily unavailable');}});
  f.state(member(42), guest(), member(42));
  await f.sync.check();
  await f.sync.check();
  assert.equal(attempts, 2);
});

test('account refresh host operation reloads only its current trusted main document', () => {
  const {isTrustedNativeURL} = require('../desktop-port/core.cjs');
  const host = fs.readFileSync(path.join(__dirname, '../desktop-port/host.cjs'), 'utf8');
  const block = host.slice(host.indexOf("handle('refreshAccount'"), host.indexOf('async function navigate'));
  let handler;
  const timers = [];
  vm.runInNewContext(block, {URL, isTrustedNativeURL, handle: (_name, fn) => {handler = fn;}, setTimeout: fn => timers.push(fn)});
  let url = 'https://bilipc.bilibili.com/index.html#/', reloads = 0, destroyed = false;
  const sender = {getURL: () => url, isDestroyed: () => destroyed, reload: () => {reloads++;}};
  assert.equal(handler({getURL: () => 'https://evil.test/'}, sender), true, 'the actual IPC sender is the last argument');
  timers.shift()(); assert.equal(reloads, 1);
  for (const invalid of ['https://bilipc.bilibili.com/player.html', 'https://bilipc.bilibili.com/search.html', 'https://www.bilibili.com/', 'https://bilipc.bilibili.com.evil.test/index.html']) {
    url = invalid; assert.throws(() => handler(sender), /native main window/);
  }
  url = 'https://bilipc.bilibili.com/index.html'; handler(sender);
  url = 'https://evil.test/'; timers.shift()(); assert.equal(reloads, 1);
  url = 'https://bilipc.bilibili.com/index.html'; handler(sender); destroyed = true;
  timers.shift()(); assert.equal(reloads, 1);
});
