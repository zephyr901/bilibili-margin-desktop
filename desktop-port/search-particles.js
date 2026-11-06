/* Desktop search fields, including the ones inside MARGIN's shadow roots. */
(() => {
  const selector = '.hs-input, .cp-input input, .top .search input, .header_search--input input';
  const fields = location.hostname === 'search.bilibili.com'
    ? `${selector}, input[type="search"], input.search-input, .search-input input`
    : selector;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let settings = {};
  const key = 'margin:settings';
  const api = window.marginDesktop;
  api.storageGet(key).then(value => { settings = value[key] || {}; }).catch(() => {});
  api.onStorageChange(changes => {
    if (changes[key]) settings = changes[key].newValue || {};
  });

  const previous = new WeakMap();
  const composing = new WeakSet();
  const snapshot = input => ({ text: input.value, start: input.selectionStart, scroll: input.scrollLeft });
  const inputFor = event => event.composedPath().find(node =>
    node instanceof HTMLInputElement && !node.readOnly && node.matches(fields));
  const disabled = () => settings.enabled === false || settings.reduceMotion || reduced.matches;
  const sample = document.createElement('canvas');
  const sampler = sample.getContext('2d', {willReadFrequently: true});
  let layer, frame = 0, particles = [];

  function paint(now) {
    frame = 0;
    const ctx = layer.getContext('2d');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    particles = disabled() ? [] : particles.filter(p => now - p.start < p.duration);
    for (const p of particles) {
      const t = Math.max(0, (now - p.start) / p.duration);
      const ease = 1 - (1 - t) ** 2;
      ctx.globalAlpha = p.opacity * (1 - t);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + p.dx * ease, p.y + p.dy * ease, p.size * (1 - t / 2), p.size * (1 - t / 2));
    }
    ctx.globalAlpha = 1;
    if (particles.length) frame = requestAnimationFrame(paint);
    else layer.hidden = true;
  }

  function burst(input, state, offset, text, removing) {
    text = Array.from(text).slice(0, 16).join('');
    if (!sampler || !text.trim()) return;
    const rect = input.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = getComputedStyle(input);
    const zoom = rect.width / Math.max(1, input.offsetWidth);
    const fontSize = parseFloat(style.fontSize);
    const spacing = parseFloat(style.letterSpacing) || 0;
    const font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    sampler.font = font;
    const prefix = state.text.slice(0, offset);
    const left = rect.left + zoom * ((parseFloat(style.borderLeftWidth) || 0) +
      (parseFloat(style.paddingLeft) || 0) - state.scroll + sampler.measureText(prefix).width +
      spacing * Array.from(prefix).length);
    const width = Math.ceil(sampler.measureText(text).width + Math.max(0, spacing) * text.length + 4);
    const height = Math.ceil(fontSize * 1.7);
    sample.width = width;
    sample.height = height;
    sampler.font = font;
    sampler.textBaseline = 'middle';
    sampler.fillText(text, 0, height / 2);
    const pixels = sampler.getImageData(0, 0, width, height).data;
    const top = rect.top + (rect.height - height * zoom) / 2;
    const now = performance.now();
    const stride = Math.max(2, Math.ceil(Math.sqrt(width * height / 450)));
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const screenX = left + x * zoom;
        if (screenX < rect.left || screenX >= rect.right || pixels[(y * width + x) * 4 + 3] < 96) continue;
        const accent = Math.random() < 0.45;
        particles.push({
          x: screenX, y: top + y * zoom, start: now,
          dx: removing ? 8 + Math.random() * 19 : (Math.random() - 0.5) * 26,
          dy: removing ? (Math.random() - 0.5) * 20 : -5 - Math.random() * 17,
          size: (accent ? 2.3 : 1.6) * zoom, opacity: accent ? 0.95 : 0.65,
          color: accent ? '#00aeec' : style.color, duration: 310 + Math.random() * 180,
        });
      }
    }
    if (!particles.length) return;
    particles = particles.slice(-480);
    if (!layer) {
      layer = document.createElement('canvas');
      layer.id = 'margin-search-particles';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646';
      document.documentElement.append(layer);
    }
    const scale = Math.min(2, devicePixelRatio);
    const w = Math.ceil(innerWidth * scale), h = Math.ceil(innerHeight * scale);
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
      layer.getContext('2d').setTransform(scale, 0, 0, scale, 0, 0);
    }
    layer.hidden = false;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function changed(input, before = previous.get(input)) {
    const after = snapshot(input);
    previous.set(input, after);
    if (!before || before.text === after.text || disabled()) return;
    // The smaller caret position distinguishes edits inside repeated text.
    const limit = Math.min(before.start ?? before.text.length, after.start ?? after.text.length);
    let start = 0, endBefore = before.text.length, endAfter = after.text.length;
    while (start < limit && before.text[start] === after.text[start]) start++;
    while (endBefore > start && endAfter > start && before.text[endBefore - 1] === after.text[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    burst(input, before, start, before.text.slice(start, endBefore), true);
    burst(input, after, start, after.text.slice(start, endAfter), false);
  }

  for (const type of ['focusin', 'beforeinput', 'compositionstart']) {
    addEventListener(type, event => {
      const input = inputFor(event);
      if (!input || composing.has(input)) return;
      previous.set(input, snapshot(input));
      if (type === 'compositionstart') composing.add(input);
    }, true);
  }
  addEventListener('input', event => {
    const input = inputFor(event);
    if (input && !event.isComposing && !composing.has(input)) changed(input);
  }, true);
  addEventListener('compositionend', event => {
    const input = inputFor(event);
    if (!input) return;
    composing.delete(input);
    changed(input);
  }, true);

  // The app's own clear buttons and Escape clear the value without emitting input.
  function watchClear(input) {
    if (!input) return;
    const before = snapshot(input);
    const tracked = previous.get(input);
    setTimeout(() => {
      if (input.isConnected && previous.get(input) === tracked && before.text !== input.value) changed(input, before);
    }, 0);
  }
  addEventListener('click', event => {
    const button = event.composedPath().find(node => node instanceof Element && node.matches('.hs-clear, .search-clear'));
    watchClear(button?.parentElement?.querySelector('input'));
  }, true);
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing) watchClear(inputFor(event));
  }, true);
})();
