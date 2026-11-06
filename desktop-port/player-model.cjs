'use strict';
function nextSpeed(key,current,remembered=1){
  let rate=current;
  if(key==='x'||key==='c')rate=Math.max(.1,Math.min(16,Math.round((current+(key==='x'?-.1:.1))*10)/10));
  else if(key==='z'){if(Math.abs(current-1)>.001){remembered=current;rate=1;}else rate=remembered;}
  if(rate!==1)remembered=rate;
  return {rate,remembered};
}
/** Preserve exact decimal IDs. CSS order changes visual order only; lit keeps DOM ownership. */
function replyLayout(rows){
  const id = (exact, numeric) => {
    if (typeof exact === 'string' && /^[1-9]\d*$/.test(exact)) return exact;
    return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
  };
  const ids = new Map();
  rows.forEach((row, index) => {
    const key = id(row?.rpid_str, row?.rpid);
    if (key && !ids.has(key)) ids.set(key, index);
  });
  const kids=new Map(),roots=[];
  rows.forEach((r,i)=>{const parent=ids.get(id(r?.parent_str,r?.parent));if(parent===undefined||parent===i)roots.push(i);else{const list=kids.get(parent)||[];list.push(i);kids.set(parent,list);}});
  const out=Array(rows.length),seen=new Set();let order=0;
  const visit=(i,depth)=>{if(seen.has(i))return;seen.add(i);out[i]={order:order++,depth:Math.min(depth,3)};for(const child of kids.get(i)||[])visit(child,depth+1);};
  for(const i of roots)visit(i,0);for(let i=0;i<rows.length;i++)visit(i,0);
  return out;
}
if(typeof module!=='undefined')module.exports={nextSpeed,replyLayout};
else globalThis.marginPlayerModel={nextSpeed,replyLayout};
