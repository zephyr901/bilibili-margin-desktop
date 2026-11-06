import { onSettingsChange, type Settings } from '../shared/settings';
import { FilterRuntime } from './filter-runtime';
import type { FilterTarget } from './filter';
import { parseCountText, parseDurationText } from './parse';
import { cachedTags, ensureTags } from './tags';

/**
 * 原生页面（搜索 / 播放页推荐 / 热门排行 / 番剧）的屏蔽词过滤器。
 * 只给命中的卡片加 data-margin-filtered="native"，隐藏交给 global.css；绝不删除 B 站节点。
 * 原生卡片能可靠拿到标题和 UP 主；播放量、时长解析不到时按未知放行。
 */
type NativeKind = 'watch' | 'search' | 'page';

export interface NativeRule {
  root: string;
  item: string;
  title: string;
  author?: string;
  views?: string;
  duration?: string;
  ad?: string;
}

const RULES: Record<NativeKind, NativeRule[]> = {
  watch: [{
    root: '.right-container, .recommend-list-v1',
    item: '.video-page-card-small, .video-card, .rec-video-card, .bili-video-card',
    title: '.title, .video-name, .bili-video-card__info--tit',
    author: '.upname, .up-name, .bili-video-card__info--author, .name',
    views: '.video-stat, .playinfo, .bili-video-card__stats--item:first-child',
    duration: '.duration, .dur, .bili-video-card__stats__duration',
  }],
  search: [{
    root: '.search-content, .video-list, #search-content',
    item: '.bili-video-card, .video-list-item',
    title: '.bili-video-card__info--tit, .bili-video-card__av--tit, .title, h3',
    author: '.bili-video-card__info--author, .bili-video-card__av--owner, .up-name, .upname',
    views: '.bili-video-card__stats--item:first-child, .video-stat, .playinfo',
    duration: '.bili-video-card__stats__duration, .duration, .dur',
    ad: '.bili-video-card__info--ad, .bili-video-card__stats__ad-icon',
  }],
  page: [{
    root: '.popular-video-container, .rank-list, .bangumi-list, .video-list',
    item: '.video-card, .rank-item, .bili-video-card, .video-list-item',
    title: '.video-name, .title, .info .title, .bili-video-card__info--tit',
    author: '.up-name, .upname, .bili-video-card__info--author, .name',
    views: '.video-stat, .playinfo, .bili-video-card__stats--item:first-child',
    duration: '.duration, .dur, .length, .bili-video-card__stats__duration',
  }],
};

const textOf = (el: Element, selector?: string): string => {
  if (!selector) return '';
  return (el.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

function targetOfNative(el: Element, rule: NativeRule): FilterTarget | null {
  const title = textOf(el, rule.title);
  if (!title) return null; // 标题都读不到就不猜
  const author = textOf(el, rule.author) || null;
  const space = el.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]')?.href;
  const mid = space?.match(/space\.bilibili\.com\/(?:\d+\/)?(\d+)/)?.[1];
  const video = el.querySelector<HTMLAnchorElement>('a[href*="/video/"]')?.href;
  const bvid = /\/video\/(BV[0-9A-Za-z]+)/.exec(video ?? '')?.[1];
  return {
    title,
    author,
    mid: mid ? Number(mid) : null,
    views: parseCountText(textOf(el, rule.views)),
    duration: parseDurationText(textOf(el, rule.duration)),
    ad: !!rule.ad && !!el.querySelector(rule.ad),
    bvid,
    tags: cachedTags(bvid),
  };
}

const hasFilters = (s: Settings): boolean =>
  s.filters.keywords.length > 0 || s.filters.ups.length > 0 || s.filters.minViews > 0 || s.filters.minDuration > 0;

export function startNativeFilter(kind: NativeKind, settings: Settings, doc = document, rules = RULES[kind]): () => void {
  let current = settings;
  let stopped = false;
  const filter = new FilterRuntime(settings);
  let marked = new Set<HTMLElement>();
  let scanT = 0;
  let href = doc.URL;
  const view = doc.defaultView ?? window;
  const shouldFilter = () => current.enabled && (hasFilters(current) || (current.hideAds && rules.some(rule => rule.ad)));
  /** 本次页面生命周期内已经请求过标签的 bvid，避免失败后反复扫描打接口 */
  const requested = new Set<string>();

  const clearMarks = () => {
    for (const el of marked) if (el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
    marked.clear();
  };

  const scan = () => {
    scanT = 0;
    if (!shouldFilter()) { clearMarks(); return; }

    // 同一张卡可能同时命中内外层选择器：只处理最外层
    const found = new Map<HTMLElement, NativeRule>();
    for (const rule of rules) {
      for (const root of doc.querySelectorAll(rule.root)) {
        for (const el of root.querySelectorAll<HTMLElement>(rule.item)) {
          if (!found.has(el)) found.set(el, rule);
        }
      }
    }
    const all = [...found.keys()];
    const top = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
    const next = new Set<HTMLElement>();

    for (const el of top) {
      if (el.closest('#margin-root, #margin-watch-top, #margin-bg, #margin-aside')) continue;
      const target = targetOfNative(el, found.get(el)!);
      if (!target) continue;
      // 关键词也要能命中视频标签：缺标签时补拉一次，回来后再扫描并标记
      if (current.filters.keywords.length && target.bvid && !cachedTags(target.bvid) && !requested.has(target.bvid)) {
        requested.add(target.bvid);
        void ensureTags(target.bvid).then(() => schedule());
      }
      if (filter.allows(target)) {
        if (el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
      } else {
        el.setAttribute('data-margin-filtered', 'native');
        next.add(el);
      }
    }
    for (const el of marked) {
      if (!next.has(el) && el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
    }
    marked = next;
  };

  const schedule = () => { if (!stopped && !scanT) scanT = window.setTimeout(scan, 140); };
  const checkRoute = () => {
    if (doc.URL === href) return;
    href = doc.URL;
    if (shouldFilter()) schedule();
  };

  const observer = new MutationObserver((records) => {
    // 没有过滤条件时完全不扫描，避免评论/弹幕持续变化时空转
    if (!shouldFilter()) return;
    // 只看 childList：自己写 data-margin-filtered 属于 attributes，观察它会造成死循环
    if (records.some((r) => r.type === 'childList')) schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  view.addEventListener('popstate', checkRoute);
  view.addEventListener('hashchange', checkRoute);
  const timer = window.setInterval(checkRoute, 1500);

  const stopSettings = onSettingsChange((next) => {
    current = next;
    filter.update(next);
    schedule();
  });
  schedule();

  return () => {
    stopped = true;
    stopSettings();
    observer.disconnect();
    clearTimeout(scanT);
    clearInterval(timer);
    view.removeEventListener('popstate', checkRoute);
    view.removeEventListener('hashchange', checkRoute);
    clearMarks();
  };
}
