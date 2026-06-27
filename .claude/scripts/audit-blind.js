// playwright-cli run-code function: audit-blind DOM scan for a dark userstyle.
// Usage: playwright-cli -s=<session> run-code --filename=.claude/scripts/audit-blind.js
// Runs AFTER the theme is injected. Returns JSON findings (bounded). DOM-detectable
// classes only — SVG/canvas raster, pseudo gauges, and screenshot-luminance still
// need a visual pass (see userstyles-audits). NOT a substitute for eyeballing.
async (page) => {
  return await page.evaluate(() => {
    const CAP = 30;
    const px = (v) => parseFloat(v) || 0;
    const rgb = (s) => {
      const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map(x => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const lum = (c) => { // relative luminance 0..1
      const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const nearWhite = (c) => c && c.a > 0.5 && c.r > 200 && c.g > 200 && c.b > 200;
    const pathOf = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { s += '#' + n.id; parts.unshift(s); break; }
        const cls = (n.className && n.className.toString ? n.className.toString() : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) s += '.' + cls;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const effBg = (el) => { // nearest opaque ancestor background-color
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.5) return c;
      }
      return { r: 20, g: 24, b: 29, a: 1 }; // page base #14181d
    };
    const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 40; };
    const out = { url: location.href, counts: {}, lightSurfaces: [], lightBorders: [], svgWhiteFills: [], darkOnDark: [], placeholders: [], webkitFillMismatch: [], lightBgImages: [], pseudoWhite: [] };
    const els = [...document.querySelectorAll('*')];

    const SKIP = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'noscript']);
    for (const el of els) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const r0 = el.getBoundingClientRect();
      const rendered = r0.width > 0 && r0.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      // 1. light surfaces
      if (tag !== 'img' && big(el) && out.lightSurfaces.length < CAP) {
        const c = rgb(cs.backgroundColor);
        if (nearWhite(c)) out.lightSurfaces.push({ sel: pathOf(el), bg: cs.backgroundColor });
      }
      // 2. light borders
      if (out.lightBorders.length < CAP && px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) > 0) {
        const bc = rgb(cs.borderTopColor) || rgb(cs.borderColor);
        if (bc && bc.a > 0.4 && bc.r > 150 && bc.g > 150 && bc.b > 150) out.lightBorders.push({ sel: pathOf(el), border: cs.borderTopColor });
      }
      // 4. dark-on-dark text
      if (rendered && out.darkOnDark.length < CAP && el.textContent && el.textContent.trim().length > 1) {
        const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (hasOwnText) {
          const tc = rgb(cs.webkitTextFillColor && cs.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' ? cs.webkitTextFillColor : cs.color);
          if (tc && tc.a > 0.5 && lum(tc) < 0.18) {
            const bg = effBg(el);
            if (lum(bg) < 0.3) out.darkOnDark.push({ sel: pathOf(el), color: cs.color, fill: cs.webkitTextFillColor, bg: `rgb(${bg.r},${bg.g},${bg.b})`, text: el.textContent.trim().slice(0, 40) });
          }
        }
      }
      // 6. webkit-text-fill-color mismatch
      if (rendered && out.webkitFillMismatch.length < CAP) {
        const f = rgb(cs.webkitTextFillColor), c = rgb(cs.color);
        if (f && c && f.a > 0.5 && (Math.abs(f.r - c.r) + Math.abs(f.g - c.g) + Math.abs(f.b - c.b) > 60)) out.webkitFillMismatch.push({ sel: pathOf(el), color: cs.color, fill: cs.webkitTextFillColor });
      }
      // 7. light background-image gradient over dark/transparent bg
      if (out.lightBgImages.length < CAP && big(el) && /gradient/i.test(cs.backgroundImage)) {
        const bg = rgb(cs.backgroundColor);
        if ((!bg || bg.a < 0.5 || lum(bg) < 0.3) && /\b(255,\s*255,\s*255|#fff|white|rgba?\(2[0-5]\d)/i.test(cs.backgroundImage)) out.lightBgImages.push({ sel: pathOf(el), bgImage: cs.backgroundImage.slice(0, 80) });
      }
      // 8. pseudo-element near-white background
      if (out.pseudoWhite.length < CAP && big(el)) {
        for (const pe of ['::before', '::after']) {
          const pcs = getComputedStyle(el, pe);
          if (pcs && pcs.content && pcs.content !== 'none') {
            const c = rgb(pcs.backgroundColor);
            if (nearWhite(c)) { out.pseudoWhite.push({ sel: pathOf(el) + pe, bg: pcs.backgroundColor }); break; }
          }
        }
      }
    }

    // 3. SVG white fills
    for (const el of document.querySelectorAll('svg rect, svg circle, svg path, svg ellipse, svg polygon, svg g[fill]')) {
      if (out.svgWhiteFills.length >= CAP) break;
      const f = el.getAttribute('fill') || getComputedStyle(el).fill;
      const c = rgb(f) || (/^#fff/i.test(f || '') || /white/i.test(f || '') ? { r: 255, g: 255, b: 255, a: 1 } : null);
      const r = el.getBoundingClientRect();
      if (nearWhite(c) && r.width * r.height > 200) out.svgWhiteFills.push({ sel: pathOf(el), fill: f });
    }

    // 5. placeholders: ::placeholder color vs input bg
    for (const el of document.querySelectorAll('input, textarea')) {
      if (out.placeholders.length >= CAP) break;
      if (!el.placeholder && el.type !== 'search' && el.type !== 'text' && el.tagName !== 'TEXTAREA') continue;
      const ph = getComputedStyle(el, '::placeholder');
      const phc = rgb(ph.color), bg = rgb(getComputedStyle(el).backgroundColor) || effBg(el);
      if (phc) {
        const contrast = Math.abs(lum(phc) - lum(bg));
        if (phc.a < 0.3 || contrast < 0.04) out.placeholders.push({ sel: pathOf(el), placeholderColor: ph.color, inputBg: getComputedStyle(el).backgroundColor, note: phc.a < 0.3 ? 'transparent' : 'too-close-to-bg' });
      }
    }

    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out.counts[k] = out[k].length;
    return out;
  });
}
