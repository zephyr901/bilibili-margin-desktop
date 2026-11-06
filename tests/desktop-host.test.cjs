const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SerialStore, assetPath, allowedURL, createWorker, isTrustedNativeURL } = require('../desktop-port/core.cjs');
const vm = require('node:vm');
const {compileCSS}=require('../desktop-port/css-compat.cjs');
const trustedPageCases = [
  ['https://bilipc.bilibili.com/index.html#/', true],
  ['https://bilipc.bilibili.com/player.html?bvid=BV1CoxY6YE4y', true],
  ['https://bilipc.bilibili.com/search.html', true],
  ['file:///C:/Temp/render/index.html', false],
  ['file:///C:/Temp/render/player.html', false],
  ['file:///C:/Temp/render/search.html', false],
  ['https://bilipc.bilibili.com/other/index.html', false],
  ['https://bilipc.bilibili.com/not-native.html', false],
  ['http://bilipc.bilibili.com/index.html', false],
  ['https://bilipc.bilibili.com:8443/index.html', false],
  ['https://user:pass@bilipc.bilibili.com/index.html', false],
  ['https://bilipc.bilibili.com.evil.test/index.html', false],
  ['https://www.bilibili.com/index.html', false],
  ['https://space.bilibili.com/index.html', false],
];
test('host trusts only exact packaged native HTTPS pages', () => {
  for (const [url, expected] of trustedPageCases) {
    assert.equal(isTrustedNativeURL(url), expected, url);
  }
  assert.equal(isTrustedNativeURL('invalid URL'), false);
});
test('actual session preload requires host authorization even for candidate origins', () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop-port/preload.cjs'), 'utf8');
  for (const [url, expected] of trustedPageCases) {
    const exposures = [];
    vm.runInNewContext(source, {
      URL,
      process:{isMainFrame:true},
      location: new URL(url),
      window: {addEventListener: (_event, callback) => callback()},
      require(name) {
        assert.equal(name, 'electron');
        return {contextBridge: {exposeInMainWorld: (...args) => exposures.push(args)}, ipcRenderer: {sendSync:()=>expected?{source:''}:null},webFrame:{executeJavaScript:async()=>{}}};
      },
    });
    assert.equal(exposures.length, expected ? 1 : 0, url);
    if (expected) assert.equal(exposures[0][0], 'marginDesktop');
  }
});
test('serial persistence preserves concurrent keys and emits old/new values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-host-'));
  try {
    const changes = []; const store = new SerialStore(path.join(dir, 'state.json'), c => changes.push(c));
    await Promise.all(Array.from({length:40}, (_, i) => store.set({['margin:k'+i]:i})));
    assert.equal(Object.keys(await store.get(null)).length, 40);
    await store.set({'margin:k1':45}); await store.remove('margin:k2');
    const reopened = new SerialStore(path.join(dir, 'state.json'));
    assert.equal((await reopened.get('margin:k1'))['margin:k1'],45);
    assert.equal((await reopened.get('margin:k2'))['margin:k2'],undefined);
    assert.deepEqual(changes[40]['margin:k1'], {oldValue:1,newValue:45});
    await assert.rejects(store.set({'native:secret':1}), /namespace/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('assets and upstream network deny traversal, credentials and foreign origins', () => {
  const root=path.resolve('assets');
  assert.equal(assetPath(root,'margin://app/pages/home.js'),path.join(root,'pages','home.js'));
  for(const u of ['margin://evil/pages/home.js','margin://app/%2e%2e%2fsecret','margin://app/%5csecret','https://app/a','margin://app/../secret']) assert.throws(()=>assetPath(root,u));
  assert.equal(allowedURL('https://api.bilibili.com/x/web-interface/nav').hostname,'api.bilibili.com');
  for(const u of ['http://api.bilibili.com/x','https://bilibili.com.evil.test/x','https://user:pass@api.bilibili.com/x','file:///secret']) assert.throws(()=>allowedURL(u));
});
test('background replies retain per-request identity and reject unhandled messages', async()=>{
  const worker=createWorker('chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.kind!=="test")return;setTimeout(()=>reply({id:m.id}),m.delay);return true})', {get:async()=>({}),set:async()=>{},remove:async()=>{}}, async()=>{}, 100);
  assert.deepEqual(await Promise.all([worker.send({kind:'test',id:1,delay:20}),worker.send({kind:'test',id:2,delay:1})]),[{id:1},{id:2}]);
  await assert.rejects(worker.send({kind:'unknown'}),/Unhandled/);
});
test('mix compiler preserves theme-scoped channels, alpha and nested mixes',()=>{
  const input='.app{--ink:#17181a;--canvas:#fff;color:color-mix(in srgb, var(--ink) 20%, transparent)}.app[data-theme="dark"]{--ink:#ededee;box-shadow:0 0 1px color-mix(in srgb, #1238 12%, color-mix(in srgb, var(--canvas) 34%, transparent))}';
  const output=compileCSS(input);assert.equal(output.count,2);assert.ok(!output.text.includes('color-mix('));assert.match(output.text,/--ink-mc-r:23/);assert.match(output.text,/--ink-mc-r:237/);assert.match(output.text,/0\.5333333333333333/);assert.match(output.text,/rgba\(calc/);
});
test('real upstream worker serializes overlapping activity beats without double counting',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'margin-worker-'));
  try{const store=new SerialStore(path.join(dir,'state.json'));const source=fs.readFileSync(path.join(__dirname,'fixtures/margin-v0.52.0-background.js'),'utf8');const worker=createWorker(source,store,async()=>{throw Error('Unexpected network');});const to=Date.now(),from=to-15000;const result=await Promise.all([worker.send({margin:'fp',op:'beat',from,to}),worker.send({margin:'fp',op:'beat',from,to})]);assert.equal(result.reduce((n,r)=>n+(r.added||0),0),15);assert.deepEqual(await worker.send({margin:'app',op:'state'}),{ok:true,authed:false,mid:0,exp:0});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
