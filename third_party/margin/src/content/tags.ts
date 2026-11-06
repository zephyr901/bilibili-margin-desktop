import { getJSON } from './api/http';

/**
 * 视频标签缓存（v0.5x）：屏蔽关键词同时也匹配视频标签。
 * B 站没有批量标签接口，只能按 bvid 逐个查：并发限制 3、缓存 7 天，
 * 并且只有用户配置了屏蔽关键词时才真正发请求（由 FilterRuntime.prepare 把关）。
 */
const STORAGE_KEY = 'margin:tag-cache';
const TTL = 7 * 864e5;
const MAX = 3000;
const CONCURRENCY = 3;
/** 请求失败后的冷却时间：这段时间内不再重试，避免反复扫描时打接口 */
const RETRY_AFTER = 5 * 60e3;

interface Entry { t: string[]; at: number }
interface Job { bvid: string; resolve: (tags: readonly string[]) => void }

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<readonly string[]>>();
const failedAt = new Map<string, number>();
const queue: Job[] = [];
let active = 0;
let saveTimer = 0;
let ready: Promise<void> | null = null;

function load(): Promise<void> {
  ready ??= (async () => {
    try {
      const raw = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Record<string, Entry> | undefined;
      if (!raw || typeof raw !== 'object') return;
      for (const [bvid, e] of Object.entries(raw)) {
        if (!e || !Array.isArray(e.t)) continue;
        cache.set(bvid, { t: e.t.map(String).filter(Boolean), at: Number(e.at) || 0 });
      }
    } catch { /* 隐私模式 / 存储不可用：只用内存缓存 */ }
  })();
  return ready;
}

/** 同步读缓存；未知或过期返回 undefined。空数组表示「查过，确实没有标签」 */
export function cachedTags(bvid: string | null | undefined): readonly string[] | undefined {
  if (!bvid) return undefined;
  const e = cache.get(bvid);
  if (!e) return undefined;
  if (Date.now() - e.at > TTL) { cache.delete(bvid); return undefined; }
  return e.t;
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const now = Date.now();
    for (const [bvid, e] of cache) if (now - e.at > TTL) cache.delete(bvid);
    while (cache.size > MAX) {
      const oldest = cache.keys().next().value;
      if (oldest == null) break;
      cache.delete(oldest);
    }
    try { void chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(cache) }); } catch { /* 忽略存储失败 */ }
  }, 800);
}

async function fetchOne(bvid: string): Promise<readonly string[]> {
  try {
    const data = await getJSON<{ tag_name?: string }[]>('/x/tag/archive/tags', { bvid });
    const tags = (data ?? []).map((x) => String(x?.tag_name ?? '').trim()).filter(Boolean).slice(0, 32);
    cache.set(bvid, { t: tags, at: Date.now() });
    failedAt.delete(bvid);
    scheduleSave();
    return tags;
  } catch {
    failedAt.set(bvid, Date.now());
    return [];
  }
}

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active++;
    void fetchOne(job.bvid).then((tags) => job.resolve(tags)).finally(() => { active--; pump(); });
  }
}

/** 取某个视频的标签：优先缓存，未知时排队请求；失败返回空数组（不当作「没有标签」缓存） */
export function ensureTags(bvid: string): Promise<readonly string[]> {
  const hit = cachedTags(bvid);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(bvid);
  if (running) return running;
  const failed = failedAt.get(bvid);
  if (failed && Date.now() - failed < RETRY_AFTER) return Promise.resolve([]);
  const p = load().then(() => {
    const again = cachedTags(bvid);
    if (again) return again;
    return new Promise<readonly string[]>((resolve) => { queue.push({ bvid, resolve }); pump(); });
  });
  inflight.set(bvid, p);
  p.then(() => inflight.delete(bvid), () => inflight.delete(bvid));
  return p;
}

/** 批量预热；具体并发由 ensureTags 的队列控制，出错按「无标签」放行，不阻塞渲染 */
export async function prepareTags(bvids: Iterable<string | null | undefined>): Promise<void> {
  const need = new Set<string>();
  for (const b of bvids) if (b && !cachedTags(b)) need.add(b);
  if (!need.size) return;
  await Promise.all([...need].map((b) => ensureTags(b)));
}

/** 从视频链接里取 bvid（历史记录只有 url，动态 / 稍后再看有 href） */
export function bvidFromHref(href: string | null | undefined): string | undefined {
  const s = href ?? '';
  return /\/video\/(BV[0-9A-Za-z]+)/.exec(s)?.[1] ?? /[?&]bvid=(BV[0-9A-Za-z]+)/.exec(s)?.[1];
}
