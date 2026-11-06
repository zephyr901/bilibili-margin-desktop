const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');

// Minimal DOM/timer boundary; the filter, predicate and parsers are production code.
function fixture({title = 'a promotion', ad = true, keywords = [], hideAds = true} = {}) {
  const timers = new Map(), listeners = new Map(), observers = [];
  let serial = 0, settingsListener;
  const attrs = new Map();
  const card = {
    title, ad, writes: 0,
    querySelector(selector) {
      if (selector === '.title') return this.title ? {textContent: this.title} : null;
      if (selector === '.ad') return this.ad ? {} : null;
      return null;
    },
    closest: () => null,
    contains: () => false,
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute(name, value) { this.writes++; attrs.set(name, value); },
    removeAttribute: name => attrs.delete(name),
  };
  const window = {
    setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id; },
    setInterval() { return ++serial; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const doc = {
    URL: 'https://bilipc.bilibili.com/search.html#/search/all?keyword=first',
    defaultView: window, documentElement: {},
    querySelectorAll: () => [{querySelectorAll: () => [card]}],
  };
  const ctx = vm.createContext({
    window, document: doc,
    clearTimeout: id => timers.delete(id), clearInterval() {},
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {} disconnect() {}
    },
    onSettingsChange(callback) { settingsListener = callback; return () => {}; },
    cachedTags: () => [], ensureTags: async () => [], prepareTags: async () => {},
  });
  const root = path.join(__dirname, '../third_party/margin/src/content');
  for (const file of ['filter.ts', 'parse.ts', 'filter-runtime.ts', 'native-filter.ts']) {
    const source = file === 'native-filter.ts' && process.env.MARGIN_FILTER_BASELINE
      ? fs.readFileSync(process.env.MARGIN_FILTER_BASELINE, 'utf8')
      : fs.readFileSync(path.join(root, file), 'utf8');
    const js = stripTypeScriptTypes(source, {mode: 'transform'})
      .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
    vm.runInContext(js, ctx, {filename: file});
  }
  let settings = {enabled:true,hideAds,filters:{keywords,ups:[],minViews:0,minDuration:0}};
  ctx.settings = settings;
  vm.runInContext("startNativeFilter('search', settings, document, [{root:'.results', item:'.card', title:'.title', ad:'.ad'}])", ctx);
  function flush() {
    let runs = 0;
    while (timers.size) {
      assert.ok(++runs < 20, 'Scan must settle');
      const [id, callback] = timers.entries().next().value;
      timers.delete(id); callback();
    }
  }
  const changed = () => { observers.forEach(fn => fn([{type:'childList'}])); flush(); };
  flush();
  return {
    card, doc, changed,
    get mark() { return card.getAttribute('data-margin-filtered'); },
    update(patch) { settings = {...settings,...patch}; settingsListener(settings); flush(); },
    route(url) { doc.URL = url; listeners.get('hashchange')?.(); flush(); },
  };
}

test('a hidden advertisement stays hidden when native virtualization unloads its content', () => {
  const f = fixture();
  assert.equal(f.mark, 'native');
  f.card.title = null; f.card.ad = false;
  for (let i = 0; i < 5; i++) { f.changed(); assert.equal(f.mark, 'native'); }
  assert.equal(f.card.writes, 1, 'Unchanged hidden state must not write the mark again');
  f.update({hideAds:false});
  assert.equal(f.mark, null, 'Turning off ad filtering must reveal the unloaded card');
});

test('clearing a keyword reveals a card even when its content is still unloaded', () => {
  const f = fixture({title:'blocked title',ad:false,keywords:['blocked']});
  assert.equal(f.mark, 'native');
  f.card.title = null;
  f.changed();
  assert.equal(f.mark, 'native');
  f.update({filters:{keywords:[],ups:[],minViews:0,minDuration:0}});
  assert.equal(f.mark, null);
});

test('new search routes discard cached decisions on reused skeleton nodes', () => {
  const f = fixture();
  f.card.title = null; f.card.ad = false;
  f.route('https://bilipc.bilibili.com/search.html#/search/all?keyword=second');
  assert.equal(f.mark, null);
});

test('a child-list scan resets stale cached decisions before the route timer runs', () => {
  const f = fixture();
  f.card.title = null; f.card.ad = false;
  f.doc.URL = 'https://bilipc.bilibili.com/search.html#/search/video?keyword=second';
  f.changed();
  assert.equal(f.mark, null);
});

test('fresh visible metadata replaces a cached filter decision on the same node', () => {
  const f = fixture({title:'blocked title',ad:false,keywords:['blocked']});
  assert.equal(f.mark, 'native');
  f.card.title = 'a different video';
  f.changed();
  assert.equal(f.mark, null);
});
