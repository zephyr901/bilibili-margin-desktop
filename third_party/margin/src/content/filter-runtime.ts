import type { Settings } from '../shared/settings';
import { compileFilter, type FilterTarget, type Predicate } from './filter';
import { prepareTags } from './tags';

/** 页面级过滤器：编译条件、叠加 hideAds，并在条件变化时通知各页面重新标记 */
export class FilterRuntime {
  private keep: Predicate;
  private hideAds: boolean;
  private hasKeywords: boolean;
  private signature: string;
  private subscribers = new Set<() => void>();

  constructor(settings: Settings) {
    this.keep = compileFilter(settings.filters);
    this.hideAds = settings.hideAds;
    this.hasKeywords = settings.filters.keywords.length > 0;
    this.signature = JSON.stringify([settings.filters, settings.hideAds]);
  }

  /** 扩展自有卡片是否可见；广告只由 hideAds 控制，不混入关键词规则 */
  allows(t: FilterTarget): boolean {
    if (this.hideAds && t.ad === true) return false;
    return this.keep(t);
  }

  /**
   * 预热这批视频的标签（只有配置了屏蔽关键词时才发请求；有缓存时立即返回）。
   * 渲染卡片之前 await 一下，关键词就能命中视频标签，而不会先显示再闪掉。
   */
  async prepare(bvids: Iterable<string | null | undefined>): Promise<void> {
    if (!this.hasKeywords) return;
    await prepareTags(bvids);
  }

  /** 返回是否发生过滤条件或 hideAds 变化 */
  update(settings: Settings): boolean {
    const signature = JSON.stringify([settings.filters, settings.hideAds]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.keep = compileFilter(settings.filters);
    this.hideAds = settings.hideAds;
    this.hasKeywords = settings.filters.keywords.length > 0;
    this.subscribers.forEach((fn) => {
      try { fn(); } catch { /* 单个订阅者失败不影响页面 */ }
    });
    return true;
  }

  onChange(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
