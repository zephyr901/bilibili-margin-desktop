import {startNativeFilter} from './adapter/content/native-filter.js';

const themeVars = ['--margin-sans', '--margin-title', '--margin-mono', '--margin-zoom', '--margin-rk'];

export function createNativeSearchSkin() {
  let frame, results, stopFilter;
  let state = null;
  const root = document.documentElement;
  const addStyles = doc => {
    for (const name of ['native-palette', 'native-search']) {
      if (doc.getElementById(`margin-${name}`)) continue;
      const link = doc.createElement('link');
      link.id = `margin-${name}`;
      link.rel = 'stylesheet';
      link.href = `margin://app/${name}.css`;
      doc.head.append(link);
    }
  };
  addStyles(document);

  function releaseResults() {
    stopFilter?.();
    stopFilter = null;
    if (!results) return;
    const html = results.documentElement;
    html.classList.remove('margin-skin', 'margin-desktop-search-results');
    delete html.dataset.marginTheme;
    for (const name of themeVars) html.style.removeProperty(name);
    results = null;
  }

  function apply() {
    if (!state) return;
    const nextFrame = document.getElementById('appSearchFrame');
    if (nextFrame !== frame) {
      frame?.removeEventListener('load', apply);
      frame = nextFrame;
      frame?.addEventListener('load', apply);
    }
    const doc = frame?.contentDocument;
    if (!doc?.head || new URL(doc.URL).origin !== 'https://bilipc.bilibili.com' || new URL(doc.URL).pathname !== '/search.html') return;
    if (doc !== results) {
      releaseResults();
      results = doc;
      addStyles(doc);
      for (const id of ['margin-fonts', 'margin-fonts-sc']) {
        const source = document.getElementById(id);
        if (source && !doc.getElementById(id)) doc.head.append(doc.importNode(source, true));
      }
      stopFilter = startNativeFilter('search', state.settings, doc);
    }
    const html = doc.documentElement;
    html.classList.add('margin-skin', 'margin-desktop-search-results');
    html.dataset.marginTheme = state.theme;
    for (const name of themeVars) {
      const value = root.style.getPropertyValue(name);
      if (value) html.style.setProperty(name, value);
      else html.style.removeProperty(name);
    }
  }

  return {
    update(theme, settings) {
      state = {theme, settings};
      root.classList.add('margin-skin');
      root.dataset.marginTheme = theme;
      apply();
    },
    stop() {
      state = null;
      frame?.removeEventListener('load', apply);
      frame = null;
      releaseResults();
      root.classList.remove('margin-skin');
      delete root.dataset.marginTheme;
    },
  };
}
