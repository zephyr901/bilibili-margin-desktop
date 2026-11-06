'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const {compileCSS}=require('./css-compat.cjs');
const repo=path.resolve(__dirname,'..');
const upstream=path.join(repo,'third_party','margin');
const {
  MARGIN_EXTENSION_ROOT: extension,
  MARGIN_OFFICIAL_ROOT: official,
  MARGIN_DESKTOP_OUTPUT: portable,
  MARGIN_DESKTOP_ASSETS: assets,
}=process.env;
if (![extension, official, portable, assets].every(value => value && path.isAbsolute(value))) {
  throw Error('Run Build.ps1 to set up the verified inputs and temporary build directories.');
}
if (path.relative(official, portable) === '' || fs.existsSync(portable) || fs.existsSync(assets)) {
  throw Error('The desktop build requires fresh output directories.');
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(assets,{recursive:true});
fs.cpSync(extension,assets,{recursive:true});
const transformations=[];
function compat(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())compat(file);else if(/\.(js|css)$/.test(file)){const original=fs.readFileSync(file,'utf8');if(!original.includes('color-mix('))continue;const result=compileCSS(original);fs.writeFileSync(file,result.text);transformations.push({file:path.relative(assets,file),mixes:result.count,sourceSha256:hash(original),resultSha256:hash(result.text)});}}}
compat(assets);
const routeSource=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'routes.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,'');
const routeCJS=routeSource+'\nmodule.exports={classifyRoute,isGuestURL,routeBridge};';
const routeBrowser='(()=>{'+routeSource+'\nwindow.marginRoutes={classifyRoute,isGuestURL,routeBridge};})();';
fs.writeFileSync(path.join(assets,'desktop-bootstrap.js'),routeBrowser+'\n'+fs.readFileSync(path.join(__dirname,'player-model.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'bootstrap.js'),'utf8'));
const sourceModules=[
  'shared/settings', 'content/fonts', 'content/motion', 'content/sched',
  'content/footprint/beat', 'content/ui/comment-skin',
  'content/native-filter', 'content/filter', 'content/filter-runtime', 'content/parse',
  'content/tags', 'content/api/http', 'content/api/md5', 'content/native-guard',
  'content/ui/triple', 'content/ui/dom',
];
for (const module of sourceModules) {
  const source = fs.readFileSync(path.join(upstream, 'src', module + '.ts'), 'utf8');
  const output = path.join(assets, 'adapter', module + '.js');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const text = stripTypeScriptTypes(source, {mode: 'transform'})
    .replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_, quote, name) => `from ${quote}${name}.js${quote}`);
  fs.writeFileSync(output, compileCSS(text).text);
}
const palette=fs.readFileSync(path.join(upstream,'src/content/watch.css'),'utf8').split('/* 顶栏：')[0];
fs.writeFileSync(path.join(assets,'native-palette.css'),compileCSS(palette).text);
for (const name of ['auth-sync.js', 'native-player.css', 'search-particles.js', 'native-comment-tree.js', 'native-search.css', 'native-search.js']) {
  fs.copyFileSync(path.join(__dirname, name), path.join(assets, name));
}
fs.writeFileSync(path.join(assets,'adapter.js'),`export {loadSettings,onSettingsChange,saveSettings,sanitizeSettings} from './adapter/shared/settings.js';\nexport {injectFonts} from './adapter/content/fonts.js';\nexport {startTracking} from './adapter/content/footprint/beat.js';\nexport {setUserReducedMotion} from './adapter/content/motion.js';\n`);
fs.copyFileSync(path.join(upstream,'LICENSE'),path.join(assets,'LICENSE-MARGIN.txt'));
const archive=fs.readFileSync(path.join(official,'resources/app.asar'));
const originalHash=hash(archive);
if(originalHash!=='c721c79870f98cf136461b1f5767a2bbabafe1e991c94f6d84da3faf7b2303b6')throw Error('Expected the supported Bilibili Windows x64 1.17.6 app.asar. The supplied file does not match its pinned SHA-256.');
const header=JSON.parse(archive.subarray(16,16+archive.readUInt32LE(12)).toString());
const before=structuredClone(header);const body=archive.subarray(8+archive.readUInt32LE(4));const additions=[];let offset=body.length;
function add(name,data){let node=header;const parts=name.split('/');for(const p of parts.slice(0,-1)){node.files[p]||={files:{}};node=node.files[p];}const blockSize=4194304,blocks=[];for(let i=0;i<data.length;i+=blockSize)blocks.push(hash(data.subarray(i,i+blockSize)));node.files[parts.at(-1)]={size:data.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:hash(data),blockSize,blocks}};additions.push({name,data});offset+=data.length;}
const entry=header.files['index.js'];
add('index.js',Buffer.concat([Buffer.from("require('./margin-desktop/host.cjs');\n"),body.subarray(Number(entry.offset),Number(entry.offset)+entry.size)]));
for(const name of ['host.cjs','core.cjs','renderer.js','native-player.js'])add('margin-desktop/'+name,fs.readFileSync(path.join(__dirname,name)));
add('margin-desktop/routes.cjs',Buffer.from(routeCJS));
function addTree(dir,prefix){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,ent.name);if(ent.isDirectory())addTree(f,prefix+'/'+ent.name);else add(prefix+'/'+ent.name,fs.readFileSync(f));}}addTree(assets,'margin-desktop/assets');
const json=Buffer.from(JSON.stringify(header)),padding=Buffer.alloc((4-(4+json.length)%4)%4),headerSize=8+json.length+padding.length,pre=Buffer.alloc(16);pre.writeUInt32LE(4,0);pre.writeUInt32LE(headerSize,4);pre.writeUInt32LE(headerSize-4,8);pre.writeUInt32LE(json.length,12);
const patched=Buffer.concat([pre,json,padding,body,...additions.map(x=>x.data)]);
let verified=0;function verify(node){for(const [name,e]of Object.entries(node.files||{})){if(e.files){verify(e);continue;}if(e.unpacked||e.link||e===before.files['index.js'])continue;const start=Number(e.offset);if(!body.subarray(start,start+e.size).equals(patched.subarray(8+headerSize+start,8+headerSize+start+e.size)))throw Error('Archive mismatch: '+name);verified++;}}verify(before);
const destination = path.join(portable, 'resources', 'app.asar');
fs.mkdirSync(path.dirname(destination), {recursive: true});
fs.copyFileSync(path.join(__dirname, 'preload.cjs'), path.join(portable, 'resources', 'margin-desktop-preload.cjs'));
const temporary = `${destination}.${process.pid}.tmp`;
try {
  fs.writeFileSync(temporary, patched);
  fs.renameSync(temporary, destination);
} finally {
  fs.rmSync(temporary, {force: true});
}
const runtimeFiles = [
  '哔哩哔哩.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll',
  'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE.electron.txt',
  'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
  'vk_swiftshader_icd.json', 'vk_swiftshader.dll', 'vulkan-1.dll',
];
for (const name of runtimeFiles) {
  const file = path.join(portable, name);
  if (!fs.existsSync(file)) fs.copyFileSync(path.join(official, name), file);
}
fs.mkdirSync(path.join(portable,'locales'),{recursive:true});for(const lang of ['zh-CN.pak','en-US.pak'])if(!fs.existsSync(path.join(portable,'locales',lang)))fs.copyFileSync(path.join(official,'locales',lang),path.join(portable,'locales',lang));
if(!fs.existsSync(path.join(portable,'resources/app.asar.unpacked')))fs.cpSync(path.join(official,'resources/app.asar.unpacked'),path.join(portable,'resources/app.asar.unpacked'),{recursive:true});
if(hash(fs.readFileSync(path.join(official,'resources/app.asar')))!==originalHash)throw Error('Official archive changed');
const report={builtAt:new Date().toISOString(),officialSha256:originalHash,officialUnchanged:true,verifiedOriginalPackedFiles:verified,portableSha256:hash(patched),addedFiles:additions.length-1,css:transformations};fs.writeFileSync(path.join(portable,'build-report.json'),JSON.stringify(report,null,2));
