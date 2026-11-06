/** Shared by host and MAIN-world navigation. All values are original website URLs. */
export function classifyRoute(value: string, base = 'https://www.bilibili.com/') {
  let u: URL;
  try { u = new URL(String(value), base); } catch { throw Error('Unsupported navigation URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw Error('Unsupported navigation origin');
  if(!/(^|\.)bilibili\.com$/.test(u.hostname))return {kind:'external',url:u.href,payload:undefined};
  const h = u.hostname, p = u.pathname.replace(/^\/[a-z]{2}(?:-[A-Za-z]{2,4})?\//, '/');
  let kind = 'browser'; let payload: Record<string, string | number> | undefined;
  const video = h === 'www.bilibili.com' && p.match(/^\/video\/(BV[\da-zA-Z]+|av\d+)(?:\/|$)/);
  const pgc = h === 'www.bilibili.com' && p.match(/^\/bangumi\/(?:play|media)\/(ep|ss)(\d+)(?:\/|$)/);
  if (video) {
    kind = 'video'; payload = video[1].startsWith('BV') ? {type:'ugc',bvid:video[1]} : {type:'ugc',aid:Number(video[1].slice(2))};
    const page = Number(u.searchParams.get('p')), time = Number(u.searchParams.get('t'));
    if (Number.isSafeInteger(page) && page > 0) payload.page = page;
    if (Number.isFinite(time) && time > 0) payload.time = time;
  } else if (pgc) { kind = 'video'; payload = {type:'ogv',[pgc[1] === 'ep' ? 'epid' : 'seasonId']:Number(pgc[2])}; }
  else if (h === 'live.bilibili.com' && /^\/\d+\/?$/.test(p)) { kind = 'live'; payload = {roomId:Number(p.split('/')[1])}; }
  else if (h === 'passport.bilibili.com') kind = 'login';
  else if (h === 'www.bilibili.com' && /^\/(?:index\.html)?$/.test(p)) kind = 'home';
  else if (h === 'search.bilibili.com') kind = 'search';
  else if (h === 'space.bilibili.com' && /^\/\d+(?:\/|$)/.test(p)) kind = 'space';
  else if (h === 'message.bilibili.com') kind = 'message';
  else if (h === 'www.bilibili.com' && /^\/(?:account\/)?history\/?$/.test(p)) kind = 'history';
  else if (h === 't.bilibili.com' && /^\/?$/.test(p)) kind = 'feed';
  else if (h === 't.bilibili.com' && /^\/\d+\/?$/.test(p) || h === 'www.bilibili.com' && /^\/(opus\/\d+|read\/cv\d+)(?:\/|$)/.test(p)) kind = 'detail';
  else if (h === 'www.bilibili.com' && !/^\/(blackboard|correspond|v\/topic|festival|bnj|ssr)(?:\/|$)/.test(p)) kind = 'page';
  return {kind,url:u.href,payload};
}

export function isGuestURL(value: string) {
  try { return ['home','search','space','message','history','feed','detail','page'].includes(classifyRoute(value).kind); } catch { return false; }
}

export function routeBridge(route: ReturnType<typeof classifyRoute>) {
  if (route.kind === 'video') return {method:'window/openPlayerWindow',payload:{...route.payload,exitMini:true}};
  if (route.kind === 'live') return {method:'window/openLiveRoomWindow',payload:route.payload!.roomId};
  if (route.kind === 'login') return {method:'auth/requestLogin',payload:undefined};
  if (route.kind === 'search') {
    const url = new URL(route.url);
    // MARGIN's plain keyword links use the client's own search and session.
    if (/^\/(?:all\/?)?$/.test(url.pathname) && [...url.searchParams.keys()].every(k => k === 'keyword')) {
      const keyword = url.searchParams.get('keyword')?.trim();
      return {method:'window/openMainWindowPage',payload:keyword ? {page:'SearchPage',meta:{keyword}} : {page:'SearchFocus'}};
    }
  }
  return {method:'window/openInAppBrowser',payload:{url:route.url}};
}
