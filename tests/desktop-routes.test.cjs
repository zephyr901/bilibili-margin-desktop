const test = require('node:test');
const assert = require('node:assert/strict');
const {classifyRoute, isGuestURL, routeBridge} = require('../desktop-port/routes.ts');
const {nextSpeed, replyLayout} = require('../desktop-port/player-model.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('original URLs retain query/hash and classify every upstream page',()=>{
  const cases=[
    ['https://www.bilibili.com/','home'],
    ['https://search.bilibili.com/all?keyword=%E9%A3%8E%E6%99%AF#results','search'],
    ['https://space.bilibili.com/2/upload/video?tid=1#top','space'],
    ['https://t.bilibili.com/?tab=video','feed'],
    ['https://message.bilibili.com/#/whisper','message'],
    ['https://www.bilibili.com/account/history?business=archive','history'],
    ['https://t.bilibili.com/123456789','detail'],
    ['https://www.bilibili.com/opus/123456789?spm_id_from=1','detail'],
    ['https://www.bilibili.com/read/cv123456','detail'],
    ['https://www.bilibili.com/v/popular/rank/all','page'],
    ['https://www.bilibili.com/blackboard/activity.html','browser'],
    ['https://member.bilibili.com/platform/home','browser'],
  ];
  for(const [url,kind] of cases){const route=classifyRoute(url);assert.equal(route.kind,kind,url);assert.equal(route.url,url);}
});
test('opening UGC and PGC from MARGIN restores an existing mini player',()=>{
  assert.deepEqual(routeBridge(classifyRoute('https://www.bilibili.com/video/BV1CoxY6YE4y?p=2&t=12')), {method:'window/openPlayerWindow',payload:{type:'ugc',bvid:'BV1CoxY6YE4y',page:2,time:12,exitMini:true}});
  assert.deepEqual(routeBridge(classifyRoute('https://www.bilibili.com/video/av170001')), {method:'window/openPlayerWindow',payload:{type:'ugc',aid:170001,exitMini:true}});
  assert.deepEqual(routeBridge(classifyRoute('https://www.bilibili.com/bangumi/play/ep123')), {method:'window/openPlayerWindow',payload:{type:'ogv',epid:123,exitMini:true}});
  assert.deepEqual(routeBridge(classifyRoute('https://www.bilibili.com/bangumi/play/ss123')), {method:'window/openPlayerWindow',payload:{type:'ogv',seasonId:123,exitMini:true}});
  assert.equal(classifyRoute('https://live.bilibili.com/123').kind,'live');
  assert.equal(classifyRoute('https://passport.bilibili.com/login').kind,'login');
});
test('plain keyword search uses native results without losing specialized search parameters',()=>{
  assert.deepEqual(routeBridge(classifyRoute('https://search.bilibili.com/all?keyword=%E9%A3%8E%E6%99%AF+%E5%9B%AD%E6%9E%97')), {
    method:'window/openMainWindowPage',payload:{page:'SearchPage',meta:{keyword:'风景 园林'}},
  });
  assert.deepEqual(routeBridge(classifyRoute('https://search.bilibili.com/')), {
    method:'window/openMainWindowPage',payload:{page:'SearchFocus'},
  });
  const url = 'https://search.bilibili.com/all?keyword=test&order=pubdate';
  assert.deepEqual(routeBridge(classifyRoute(url)), {method:'window/openInAppBrowser',payload:{url}});
});
test('untrusted schemes, deceptive hosts, credentials and ports fail closed',()=>{
  for(const url of ['javascript:alert(1)','file:///C:/x','data:text/html,x','http://www.bilibili.com/','https://user:pw@www.bilibili.com/','https://www.bilibili.com:8443/'])assert.throws(()=>classifyRoute(url),/Unsupported/);
  for(const url of ['https://github.com/','https://www.bilibili.com.evil.test/','https://evil.test/']){assert.equal(classifyRoute(url).kind,'external');assert.equal(isGuestURL(url),false);}
});
test('guest injection is scoped away from native shells login and unsupported hosts',()=>{
  for(const url of ['https://search.bilibili.com/all','https://space.bilibili.com/2','https://t.bilibili.com/','https://message.bilibili.com/#/reply','https://www.bilibili.com/history','https://www.bilibili.com/read/cv1'])assert.equal(isGuestURL(url),true,url);
  for(const url of ['https://bilipc.bilibili.com/index.html','https://bilipc.bilibili.com/player.html','https://bilipc.bilibili.com/universal.html','https://passport.bilibili.com/login','https://member.bilibili.com/','https://www.bilibili.com/blackboard/a','file:///render/index.html','https://live.bilibili.com/blanc/1'])assert.equal(isGuestURL(url),false,url);
});
test('speed keys clamp and restore a remembered nondefault speed',()=>{
  assert.deepEqual(nextSpeed('c',1,1),{rate:1.1,remembered:1.1});
  assert.equal(nextSpeed('x',.1,1).rate,.1);
  assert.equal(nextSpeed('c',16,1).rate,16);
  assert.deepEqual(nextSpeed('z',1.7,1),{rate:1,remembered:1.7});
  assert.deepEqual(nextSpeed('z',1,1.7),{rate:1.7,remembered:1.7});
});
test('reply tree uses exact string IDs, absent parents, cycles and depth cap',()=>{
  const out=replyLayout([{rpid_str:'90071992547409931',parent_str:'1'}, {rpid_str:'3',parent_str:'90071992547409931'}, {rpid_str:'4',parent_str:'3'}, {rpid_str:'5',parent_str:'4'}, {rpid_str:'6',parent_str:'5'}, {rpid_str:'7',parent_str:'missing'}]);
  assert.deepEqual(out.map(x=>x.depth),[0,1,2,3,3,0]);
  assert.deepEqual(out.map(x=>x.order),[0,1,2,3,4,5]);
  assert.equal(replyLayout([{rpid_str:'1',parent_str:'2'},{rpid_str:'2',parent_str:'1'}]).length,2);
  const reordered=replyLayout([{rpid_str:'2',parent_str:'90071992547409931'},null,{rpid_str:'90071992547409931',parent_str:'0'},{rpid_str:'3'}]);
  assert.deepEqual(reordered,[{order:2,depth:1},{order:0,depth:0},{order:1,depth:0},{order:3,depth:0}]);
});
test('scoped preload never exposes API to an iframe or host-denied guest',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../desktop-port/preload.cjs'),'utf8');
  for(const [url,main,permit,count] of [
    ['https://search.bilibili.com/all',true,true,1],
    ['https://search.bilibili.com/all',false,true,0],
    ['https://search.bilibili.com/all',true,false,0],
    ['https://bilipc.bilibili.com/universal.html',true,true,0],
    ['https://www.bilibili.com.evil.test/',true,true,0],
    ['file:///render/player.html',true,true,0],
  ]) {
    let exposed = 0;
    vm.runInNewContext(source, {
      URL,
      location: new URL(url),
      process: {isMainFrame: main},
      window: {addEventListener: (_event, callback) => callback()},
      require: () => ({
        contextBridge: {exposeInMainWorld: () => exposed++},
        ipcRenderer: {sendSync: () => permit ? {source: ''} : null},
        webFrame: {executeJavaScript: async () => {}},
      }),
    });
    assert.equal(exposed, count, url);
  }
});
test('auth notification pair debounces to one refresh and handles logged-out false',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../desktop-port/bootstrap.js'),'utf8');
  const handlers={},timers=new Map();let id=0,reloads=0;
  const fake={marginDesktop:{onStorageChange:()=>{},log:()=>{}},chrome:{},open:()=>{},biliBridgePc:{addListener:(name,fn)=>handlers[name]=fn}};
  vm.runInNewContext(source,{window:fake,URL,URLSearchParams,document:{readyState:'complete',documentElement:{},addEventListener:()=>{}},location:{href:'https://message.bilibili.com/',reload:()=>reloads++},performance:{now:()=>1},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
  handlers['auth/userLoginChange']({data:false});handlers['auth/userInfoChange']({data:null});
  assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(reloads,1);
});
