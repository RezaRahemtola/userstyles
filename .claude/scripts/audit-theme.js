// playwright-cli run-code function: audit-theme — THE DOM scan for a dark userstyle.
// Usage: playwright-cli -s=<session> run-code --filename=.claude/scripts/audit-theme.js
// Run AFTER the theme is injected. Returns JSON: { url, counts, <bucket arrays>, summary }.
//
// (Was `audit-blind.js` + a second-pass `audit-pseudo.js`, both retired 2026-07-10. The
// name meant "the classes a naive audit is BLIND to"; now that it is the only scanner,
// it is simply the theme audit. The bug classes are still called audit-blind classes.)
//
// ============================================================================
// A CLEAN RUN IS NOT EVIDENCE. Eyeball the screenshots.
// ============================================================================
// On the 2026-07-09 patrol this scanner returned 0/0/0 on slashdot's front page,
// story page and 404 while those three carried six real bugs between them, and on a
// genius 404 carrying a giant pure-black magnifier. It sees the DOM, not the pixels.
//
// WHAT IT FINDS — 14 buckets, in two groups.
//
// A. Element-level classes (the original audit-blind.js):
//   1. lightSurfaces      near-white background-color on a big() element (w>120,h>40)
//   2. lightBorders       near-white border on any element
//   3. svgWhiteFills      white fill= on a rendered SVG shape
//   4. darkOnDark         dark text (lum<0.18) on a dark backdrop (lum<0.3)
//   5. placeholders       ::placeholder transparent, or too close to the input bg
//   6. webkitFillMismatch -webkit-text-fill-color diverging from `color` (colour
//                         audits false-negative: `color` reads fine, the FILL paints)
//   7. lightBgImages      light gradient background-IMAGE over a dark/transparent bg
//                         (scroll-fade masks, washed cards)
//   8. pseudoWhite        near-white ::before/::after BACKGROUND (element-bg scans
//                         structurally cannot see a pseudo-element)
//
// B. Second-pass classes — bug shapes group A structurally cannot see. These were a
//    separate `audit-pseudo.js` until 2026-07-10; folded in here so one scan covers all:
//   9. pseudoText         ::before/::after with `content:` (incl. attr()). This is TEXT
//                         with NO TEXT NODE, so every getComputedStyle(el).color walk
//                         misses it. Reports colour vs backdrop + contrast ratio.
//                         Flags <4.5:1 normal, <3:1 large (>=24px, or >=18.66px bold).
//                         [pypi: 30 FAQ icons @3.2:1]
//  10. gradientStops      SVG paint-servers: fill="url(#g)" whose <stop stop-color> runs
//                         near-black/near-white. DOUBLY blind: the fill reads as
//                         `url(...)` so the fill scan skips it, and there is no `color`.
//  11. symbolFills        <symbol>/<use> sprite instances whose SOURCE paths are painted
//                         near-black by an inline <style> INSIDE the symbol. The rendered
//                         <use> inherits our light `fill`; the source paths do not.
//  12. smallLight         light surfaces UNDER big()'s floor: progress-bar tracks,
//                         pagination discs, chips, short pills, table headers.
//                         [slashdot: 11x14 slider thumbs | pypi: 57x36 "Older" button]
//  13. filledCarets       CSS-triangle carets flattened by a blanket `* { border-color }`
//                         reset: a tiny box whose side borders should be transparent now
//                         has >=3 opaque sides, so it renders as a solid rectangle.
//                         NOTE: `*` does NOT match pseudo-elements, so pseudo triangles
//                         are safe; only REAL-ELEMENT triangles are at risk.
//                         [slashdot: blockquote.msg .slant fortune-quote pointer]
//  14. activeBorders      "you are here" indicators (thick single-side border on an
//                         active/current/selected/aria-current element) flattened to the
//                         generic line colour instead of the accent.
//                         [pypi: .vertical-tabs__tab--is-active — and note its
//                          border-width was 0, so a colour-only override never painted]
//
// WHAT IT CANNOT FIND
//   - <canvas>, raster images, background sprites: needs screenshot luminance.
//   - SEMANTIC wrongness. A flattened `.button--danger` or an erased ad-disclosure tint
//     is a legible dark button on a dark page: every threshold here passes. Read the
//     site's own CSS for the modifier classes you may have swallowed.
//   - Anything behind a state you did not open: closed dropdowns, collapsed accordions,
//     hover-only tooltips, mobile nav sublists, portal/annotation overlays that do not
//     exist in the DOM until opened. OPEN THEM, then re-run.
//   - Cross-origin stylesheets are unreadable (sheet.cssRules throws), so it cannot
//     attribute a colour to a specific rule. curl the stylesheet instead.
//   - `color: initial` flipped white by `color-scheme: dark` shows up only if the
//     element is currently VISIBLE. Force visibility to catch it.
//   - Anything at a viewport you did not test. Resize to 390x844 and re-run.
//
// KNOWN FALSE POSITIVES
//   - Our OWN deliberate accent overrides (a link we intentionally paint brand blue)
//     surface in pseudoText/gradientStops. Check the colour against the palette.
//   - Cross-origin ad iframes and video players (jwplayer) carry white SVG control
//     glyphs and 2px borders: harness artifacts, not theme bugs.
//   - Decorative gradient stops meant to be near-white on a dark surface.
//   - lightBgImages stays lit after a `background-blend-mode` fix — it cannot see blend.
async (page) => {
  return await page.evaluate(() => {
    const CAP = 30;
    const px = (v) => parseFloat(v) || 0;
    const rgb = (s) => {
      const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map(x => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const hexToRgb = (h) => {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((h || '').trim()); if (!m) return null;
      let x = m[1]; if (x.length === 3) x = x.split('').map(c => c + c).join('');
      return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: 1 };
    };
    const anyColor = (s) => rgb(s) || hexToRgb(s);
    const lum = (c) => { // relative luminance 0..1
      const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const contrast = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const nearWhite = (c) => c && c.a > 0.5 && c.r > 200 && c.g > 200 && c.b > 200;
    const nearBlack = (c) => c && c.a > 0.5 && lum(c) < 0.06;
    const isTransparentStr = (s) => s === 'transparent' || /,\s*0\)\s*$/.test(s || '');
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
    const bigBox = (r) => r.width > 120 && r.height > 40;

    const out = {
      url: location.href, counts: {},
      // group A
      lightSurfaces: [], lightBorders: [], svgWhiteFills: [], darkOnDark: [],
      placeholders: [], webkitFillMismatch: [], lightBgImages: [], pseudoWhite: [],
      // group B
      pseudoText: [], gradientStops: [], symbolFills: [], smallLight: [],
      filledCarets: [], activeBorders: []
    };

    const SKIP = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'noscript']);

    // ---- single walk over every element ------------------------------------
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const cs = getComputedStyle(el);
      const r0 = el.getBoundingClientRect();
      const isBig = bigBox(r0);
      const rendered = r0.width > 0 && r0.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      const renderedOpaque = rendered && cs.opacity !== '0';

      // 1. light surfaces
      if (tag !== 'img' && isBig && out.lightSurfaces.length < CAP) {
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
      if (out.lightBgImages.length < CAP && isBig && /gradient/i.test(cs.backgroundImage)) {
        const bg = rgb(cs.backgroundColor);
        if ((!bg || bg.a < 0.5 || lum(bg) < 0.3) && /\b(255,\s*255,\s*255|#fff|white|rgba?\(2[0-5]\d)/i.test(cs.backgroundImage)) out.lightBgImages.push({ sel: pathOf(el), bgImage: cs.backgroundImage.slice(0, 80) });
      }

      // 8. pseudo-element near-white background
      if (out.pseudoWhite.length < CAP && isBig) {
        for (const pe of ['::before', '::after']) {
          const pcs = getComputedStyle(el, pe);
          if (pcs && pcs.content && pcs.content !== 'none') {
            const c = rgb(pcs.backgroundColor);
            if (nearWhite(c)) { out.pseudoWhite.push({ sel: pathOf(el) + pe, bg: pcs.backgroundColor }); break; }
          }
        }
      }

      // 9. pseudo-element TEXT contrast (content: / attr())
      if (out.pseudoText.length < CAP && renderedOpaque) {
        for (const pe of ['::before', '::after']) {
          const pcs = getComputedStyle(el, pe);
          const content = pcs.content;
          if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") continue;
          const col = anyColor(pcs.webkitTextFillColor) || anyColor(pcs.color);
          if (!col || col.a < 0.4) continue;
          const bg = effBg(el);
          const ratio = contrast(col, bg);
          const fs = px(pcs.fontSize), bold = parseInt(pcs.fontWeight, 10) >= 700;
          const large = fs >= 24 || (fs >= 18.66 && bold);
          const threshold = large ? 3 : 4.5;
          if (ratio < threshold) {
            out.pseudoText.push({
              sel: pathOf(el) + pe, text: content.slice(0, 30),
              color: pcs.webkitTextFillColor || pcs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})`,
              ratio: +ratio.toFixed(2), threshold, fontSize: pcs.fontSize
            });
            if (out.pseudoText.length >= CAP) break;
          }
        }
      }

      // 12. light surfaces UNDER the big() floor
      if (out.smallLight.length < CAP && tag !== 'img' && tag !== 'iframe' && renderedOpaque) {
        const meaningful = r0.width >= 8 && r0.height >= 1 && r0.width * r0.height >= 24;
        if (!isBig && meaningful) {
          const c = rgb(cs.backgroundColor);
          if (nearWhite(c)) out.smallLight.push({ sel: pathOf(el), bg: cs.backgroundColor, size: `${Math.round(r0.width)}x${Math.round(r0.height)}` });
        }
      }

      // 13. CSS-triangle carets flattened by a blanket border-color reset
      if (out.filledCarets.length < CAP && tag !== 'iframe') {
        const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
        if (bw.reduce((a, b) => a + b, 0) >= 6) {
          const w = px(cs.width), h = px(cs.height);
          const tinyBox = (!cs.width || cs.width === 'auto' || w <= 2) && (!cs.height || cs.height === 'auto' || h <= 2);
          if (tinyBox) {
            const cols = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
            const opaque = cols.filter(c => !isTransparentStr(c)).length;
            const zeroSides = bw.filter(x => x === 0).length;
            // a real triangle has >=1 zero-width side or >=2 transparent sides;
            // if it now has 3-4 opaque colours it is rendering as a solid block.
            if (opaque >= 3 && zeroSides >= 1) {
              out.filledCarets.push({ sel: pathOf(el), borderWidths: bw.join('/'), borderColors: cols.join(' | '), note: 'transparent sides repainted -> renders as rectangle' });
            }
          }
        }
      }
    }

    // ---- 3. SVG white fills -------------------------------------------------
    for (const el of document.querySelectorAll('svg rect, svg circle, svg path, svg ellipse, svg polygon, svg g[fill]')) {
      if (out.svgWhiteFills.length >= CAP) break;
      const f = el.getAttribute('fill') || getComputedStyle(el).fill;
      const c = rgb(f) || (/^#fff/i.test(f || '') || /white/i.test(f || '') ? { r: 255, g: 255, b: 255, a: 1 } : null);
      const r = el.getBoundingClientRect();
      if (nearWhite(c) && r.width * r.height > 200) out.svgWhiteFills.push({ sel: pathOf(el), fill: f });
    }

    // ---- 5. placeholders: ::placeholder color vs input bg -------------------
    for (const el of document.querySelectorAll('input, textarea')) {
      if (out.placeholders.length >= CAP) break;
      if (!el.placeholder && el.type !== 'search' && el.type !== 'text' && el.tagName !== 'TEXTAREA') continue;
      const ph = getComputedStyle(el, '::placeholder');
      const phc = rgb(ph.color), bg = rgb(getComputedStyle(el).backgroundColor) || effBg(el);
      if (phc) {
        const delta = Math.abs(lum(phc) - lum(bg));
        if (phc.a < 0.3 || delta < 0.04) out.placeholders.push({ sel: pathOf(el), placeholderColor: ph.color, inputBg: getComputedStyle(el).backgroundColor, note: phc.a < 0.3 ? 'transparent' : 'too-close-to-bg' });
      }
    }

    // ---- 14. active-state indicators flattened to the line colour -----------
    for (const el of document.querySelectorAll('[class*="active"],[class*="current"],[class*="selected"],[aria-current],[aria-selected="true"],[role="tab"]')) {
      if (out.activeBorders.length >= CAP) break;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0')) continue;
      const sides = [['top', px(cs.borderTopWidth), cs.borderTopColor], ['bottom', px(cs.borderBottomWidth), cs.borderBottomColor], ['left', px(cs.borderLeftWidth), cs.borderLeftColor], ['right', px(cs.borderRightWidth), cs.borderRightColor]];
      const thick = sides.filter(s => s[1] >= 2);
      if (!thick.length || thick.length === 4) continue;
      // flag when the indicator is a low-contrast grey against its own backdrop:
      // a real "you are here" mark should pop, not match the divider colour.
      for (const [side, width, color] of thick) {
        const c = rgb(color); if (!c || c.a < 0.4) continue;
        const bg = effBg(el);
        if (contrast(c, bg) < 2) {
          out.activeBorders.push({ sel: pathOf(el), side, width: width + 'px', color, bg: `rgb(${bg.r},${bg.g},${bg.b})`, ratio: +contrast(c, bg).toFixed(2), note: 'active indicator flattened to line colour' });
          break;
        }
      }
    }

    // ---- 10. SVG gradient paint-servers with near-black/near-white stops ----
    // Deduped by stop signature: a sprite often repeats one gradient 20+ times.
    const usedPaint = new Set();
    for (const el of document.querySelectorAll('svg *')) {
      const f = getComputedStyle(el).fill || el.getAttribute('fill') || '';
      const m = /url\(["']?#([^"')]+)/.exec(f);
      if (m) usedPaint.add(m[1]);
    }
    const seenGrad = new Map();
    for (const g of document.querySelectorAll('linearGradient, radialGradient')) {
      // computed FIRST: we override stops via the `stop-color` CSS property, so the
      // attribute still reads the site's original hex long after the fix landed.
      const stops = [...g.querySelectorAll('stop')].map(s => (getComputedStyle(s).stopColor || s.getAttribute('stop-color') || '').trim());
      const bad = stops.filter(s => { const c = anyColor(s); return nearBlack(c) || nearWhite(c); });
      if (!bad.length) continue;
      const key = stops.join('>');
      if (!seenGrad.has(key)) seenGrad.set(key, { stops, offending: [...new Set(bad)], ids: [], referenced: false });
      const rec = seenGrad.get(key);
      if (rec.ids.length < 4) rec.ids.push(g.id || '(anonymous)');
      if (usedPaint.has(g.id)) rec.referenced = true;
    }
    for (const rec of seenGrad.values()) {
      if (out.gradientStops.length >= CAP) break;
      out.gradientStops.push({ ...rec, instances: [...seenGrad.keys()].length, fix: 'stop[stop-color="<hex>"] { stop-color: … !important }' });
    }

    // ---- 11. <symbol> source paths with a HARDCODED near-black paint --------
    // Only shapes whose paint is EXPLICIT count: a `fill` attribute, or a class painted
    // by a <style> inside the symbol. A shape with no explicit paint (computed black
    // merely because that is the SVG initial value) inherits our light fill at the <use>
    // site and is NOT a bug — that was the noise source. near-WHITE symbol fills are
    // normal in a dark theme, so only near-black flags.
    for (const sym of document.querySelectorAll('symbol')) {
      if (out.symbolFills.length >= CAP) break;
      if (!sym.id) continue;
      let inUse = null;
      try { inUse = document.querySelector(`use[href="#${CSS.escape(sym.id)}"], use[*|href="#${CSS.escape(sym.id)}"]`); } catch (e) { /* bad id */ }
      if (!inUse) continue;
      const hasInlineStyle = !!sym.querySelector('style');
      const offenders = [];
      for (const shape of sym.querySelectorAll('path, circle, rect, polygon, ellipse')) {
        const attrFill = shape.getAttribute('fill');
        const styledBySymbol = hasInlineStyle && shape.getAttribute('class');
        if (!attrFill && !styledBySymbol) continue;      // paint is inherited -> fine
        const c = anyColor(getComputedStyle(shape).fill); // post-theme computed value
        if (nearBlack(c)) offenders.push({ cls: shape.getAttribute('class') || '(no class)', fill: getComputedStyle(shape).fill, source: attrFill ? 'fill attribute' : 'inline <style> in <symbol>' });
      }
      if (offenders.length) {
        out.symbolFills.push({
          symbol: '#' + sym.id, inlineStyleTag: hasInlineStyle, offenders: offenders.slice(0, 6),
          note: 'rendered <use> inherits our fill, but the SOURCE paths do not — target the symbol\'s own classes/ids'
        });
      }
    }

    // dedupe pseudoText: one row per (class, pseudo, colour) — cards repeat it N times
    const seenPT = new Set();
    out.pseudoText = out.pseudoText.filter(x => {
      const k = x.sel.split(' > ').pop() + x.color;
      if (seenPT.has(k)) return false; seenPT.add(k); return true;
    });

    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out.counts[k] = out[k].length;
    out.summary = `audit-theme ${location.pathname} :: ` +
      Object.entries(out.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') +
      ` :: total=${Object.values(out.counts).reduce((a, b) => a + b, 0)}`;
    return out;
  });
}
