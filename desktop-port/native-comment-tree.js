const PANELS = 'bili-comments, bili-comments-reply-detail, bili-comments-reply-dialog';
const THREADS = 'bili-comment-thread-renderer, bili-comment-replies-renderer';
const LISTS = {
  'bili-comment-replies-renderer': ['#expander-contents', 'bili-comment-reply-renderer'],
  'bili-comments-reply-detail': ['#contents > #feed, #contents > #new', 'bili-comment-thread-renderer'],
  'bili-comments-reply-dialog': ['#contents > #feed, #contents > #new', 'bili-comment-thread-renderer'],
};

export function watchCommentTree(replyLayout, skinCommentHost) {
  let enabled = true;
  const seen = new WeakSet();
  const waiting = new WeakSet();
  const listRoots = new Set();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [data-margin-reply-tree] {
      display: flex !important;
      flex-direction: column !important;
      --margin-reply-line: var(--m-line, rgba(127, 127, 127, .35));
    }
    [data-margin-reply-tree] > #expander-footer { order: 99999 !important; }
    [data-margin-reply-depth] {
      position: relative;
      margin-inline-start: calc(4px + 13px * var(--margin-reply-depth));
      padding-inline-start: 10px;
      border-inline-start: 1px solid var(--margin-reply-line);
    }
    [data-margin-reply-depth]::before {
      content: '';
      pointer-events: none;
      position: absolute;
      inset-inline-start: 0;
      top: 13px;
      width: 7px;
      border-top: 1px solid var(--margin-reply-line);
    }
  `);

  function layout(root) {
    const [listSelector, rowSelector] = LISTS[root.host.localName];
    for (const list of root.querySelectorAll(listSelector)) {
      const rows = [...list.querySelectorAll(`:scope > ${rowSelector}`)];
      const on = enabled && rows.length > 0;
      list.toggleAttribute('data-margin-reply-tree', on);
      const positions = on ? replyLayout(rows.map(row => row.data)) : [];
      rows.forEach((row, index) => {
        const position = positions[index];
        if (position) {
          row.style.order = String(position.order);
          row.style.setProperty('--margin-reply-depth', String(position.depth));
          row.dataset.marginReplyDepth = String(position.depth);
        } else if (row.hasAttribute('data-margin-reply-depth')) {
          row.style.removeProperty('order');
          row.style.removeProperty('--margin-reply-depth');
          delete row.dataset.marginReplyDepth;
        }
      });
    }
  }

  function observe(host) {
    const root = host.shadowRoot;
    if (seen.has(host)) {
      if (Object.hasOwn(LISTS, host.localName) && !listRoots.has(root)) {
        listRoots.add(root);
        layout(root);
      }
      if (host.matches(PANELS)) root.querySelectorAll(THREADS).forEach(observe);
      return;
    }
    if (!root) {
      if (waiting.has(host)) return;
      waiting.add(host);
      customElements.whenDefined(host.localName).then(() => host.updateComplete).then(() => {
        waiting.delete(host);
        if (host.isConnected && host.shadowRoot) observe(host);
      }).catch(() => waiting.delete(host));
      return;
    }
    seen.add(host);
    if (host.matches(PANELS)) skinCommentHost(host);
    const hasLists = Object.hasOwn(LISTS, host.localName);
    if (hasLists) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      listRoots.add(root);
    }
    const refresh = () => {
      if (hasLists) layout(root);
      root.querySelectorAll(THREADS).forEach(observe);
    };
    new MutationObserver(refresh).observe(root, {childList: true, subtree: true});
    refresh();
  }

  document.querySelectorAll(PANELS).forEach(observe);
  new MutationObserver(records => {
    for (const root of listRoots) if (!root.host.isConnected) listRoots.delete(root);
    for (const {addedNodes} of records) for (const node of addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(PANELS)) observe(node);
      else node.querySelectorAll(PANELS).forEach(observe);
    }
  }).observe(document.documentElement, {childList: true, subtree: true});

  return on => {
    enabled = on;
    for (const root of listRoots) {
      if (root.host.isConnected) layout(root);
      else listRoots.delete(root);
    }
  };
}
