// playwright-cli run-code function: audit-chroma — the SEMANTIC flattening detector.
// Usage: playwright-cli -s=<session> run-code --filename=.claude/scripts/audit-chroma.js
// Run AFTER the theme is injected. It detaches our sheet, re-reads the page, restores it,
// and diffs. Returns JSON: { url, counts, flattened, painted, summary }.
//
// ============================================================================
// WHY THIS EXISTS — audit-theme.js cannot see semantics.
// ============================================================================
// The dominant bug class across the 2026-07-09/10 patrols was OUR OWN broad rules
// flattening the site's meaningful colours:
//   sohu   `#Index *` painted a stock GAIN and a LOSS the identical grey.
//   pepper a base-class `!important` swallowed .button--mode-{expired,danger,success}.
//   khan   `button[class]` erased the selected answer AND the correct-answer green.
//   thingiverse  badges, flairs, the selected dot, a primary CTA's blue fill.
//
// Every one is a legible dark control on a dark page. Contrast passes. Luminance
// passes. `lightSurfaces` is empty. The defect is that the page no longer distinguishes
// danger from neutral, gain from loss, selected from unselected.
//
// The only way to see it: compare against what the SITE meant to paint.
//
// ============================================================================
// WHAT IT REPORTS
// ============================================================================
//   flattened — native value was CHROMATIC (max(r,g,b)-min(r,g,b) >= CHROMA_MIN, a>0)
//               and our themed value is transparent or achromatic. A lost signal.
//   painted   — native value was TRANSPARENT and we painted it. Catches a blanket
//               `* { border-color }` boxing in every `border:1px solid transparent`
//               control, and background rules that fill natively-bare elements.
//
// NOISE CONTROL (without these it drowns you):
//   * a border colour is only read on a side whose border-width > 0 — an unpainted
//     border reports `currentColor` and false-positives on every element.
//   * zero-size and invisible elements are skipped.
//   * results are deduped by (tag.class, property, native→themed) so a 50-card grid
//     reports once, with a count.
//
// LIMITS: it cannot see canvas/SVG paint, and it only inspects the states currently
// rendered — open your flyouts first. A deliberate re-colour (we intentionally dim a
// brand pill) shows up here too; check each hit against the palette before "fixing" it.
async (page) => {
  const CHROMA_MIN = 30;

  // ---- 1. tag every element and snapshot the THEMED computed values -------
  const themed = await page.evaluate((CHROMA_MIN) => {
    const els = [...document.querySelectorAll('body *')];
    const out = [];
    els.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      el.setAttribute('data-chroma-idx', String(i));
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(s => parseFloat(cs['border' + s + 'Width']) > 0);
      out.push({
        i,
        bg: cs.backgroundColor,
        color: cs.color,
        // only read a border colour from a side that actually has width
        border: sides.length ? cs['border' + sides[0] + 'Color'] : null,
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString ? el.className.toString() : '').trim().split(/\s+/).slice(0, 2).join('.'),
      });
    });
    return out;
  }, CHROMA_MIN);

  // ---- 2..4 DETACH / snapshot native / RESTORE ----------------------------
  //
  // This is the ONLY stateful scanner we have: it removes the theme, waits for the
  // cascade, reads, and puts it back. The restore MUST run even if the native snapshot
  // throws (a navigation, a detached frame), or the page is left UNSTYLED with stray
  // data-chroma-idx attributes — and any promo captured afterwards would be silently
  // wrong. Hence try/finally. (This is also why it is a separate script from
  // audit-theme.js, which is read-only and safe to run in any state.)
  let native = {};
  try {
    await page.evaluate(() => {
      window.__chromaSaved = { nodes: [], adopted: null };
      // pw-inject.sh injects a <style> tag, or falls back to adoptedStyleSheets under CSP.
      // Prefer an explicit marker; fall back to sniffing the palette. Sniffing alone can
      // match a SITE stylesheet that happens to declare color-scheme.
      for (const st of [...document.querySelectorAll('style')]) {
        const t = st.textContent || '';
        const ours = st.id === '__pw_inject__' || st.dataset.userstyle === '1' ||
          t.includes('#14181d') || t.includes('color-scheme: dark') || t.includes('color-scheme:dark');
        if (ours) {
          window.__chromaSaved.nodes.push([st, st.parentNode, st.nextSibling]);
          st.remove();
        }
      }
      if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
        window.__chromaSaved.adopted = document.adoptedStyleSheets;
        document.adoptedStyleSheets = [];
      }
      return window.__chromaSaved.nodes.length;
    });

    await page.waitForTimeout(450); // let the cascade settle

    native = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-chroma-idx]')) {
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(s => parseFloat(cs['border' + s + 'Width']) > 0);
        out[el.getAttribute('data-chroma-idx')] = {
          bg: cs.backgroundColor,
          color: cs.color,
          border: sides.length ? cs['border' + sides[0] + 'Color'] : null,
        };
      }
      return out;
    });
  } finally {
    // Runs on the happy path AND on any throw above.
    await page.evaluate(() => {
      const s = window.__chromaSaved;
      for (const el of document.querySelectorAll('[data-chroma-idx]')) el.removeAttribute('data-chroma-idx');
      if (!s) return;
      for (const [node, parent, next] of s.nodes) (parent || document.head).insertBefore(node, next);
      if (s.adopted) document.adoptedStyleSheets = s.adopted;
      delete window.__chromaSaved;
    }).catch(() => {}); // a dead page cannot be restored; do not mask the original error
  }

  // ---- 5. diff, in node ---------------------------------------------------
  const rgb = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const chroma = (c) => (c ? Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) : 0);
  const opaque = (c) => c && c.a > 0.15;
  const isChromatic = (c) => opaque(c) && chroma(c) >= CHROMA_MIN;

  // "Flattened" is RELATIVE, not absolute. Our neutral text grey #c4cdd6 has chroma 18,
  // so an absolute `< 12` cutoff misses it — and that grey is exactly what sohu's stock
  // gain and loss were both repainted to (native chroma 182 → 18). Flag when the hue has
  // collapsed to a small fraction of what the site painted, or vanished entirely.
  const FLAT_RATIO = 0.25;
  const isFlat = (nc, tc) => !opaque(tc) || chroma(tc) <= Math.max(12, FLAT_RATIO * chroma(nc));

  const flattened = [];
  const painted = [];
  for (const t of themed) {
    const n = native[String(t.i)];
    if (!n) continue;
    for (const prop of ['bg', 'color', 'border']) {
      if (t[prop] == null || n[prop] == null) continue;
      const nc = rgb(n[prop]), tc = rgb(t[prop]);
      if (!nc || !tc) continue;
      if (n[prop] === t[prop]) continue;
      // a semantic colour the site painted, which we flattened away
      if (isChromatic(nc) && isFlat(nc, tc)) {
        flattened.push({ sel: `${t.tag}${t.cls ? '.' + t.cls : ''}`, prop, native: n[prop], themed: t[prop], nativeChroma: chroma(nc) });
      }
      // something natively bare that we painted (blanket border/background resets)
      if (!opaque(nc) && opaque(tc) && prop !== 'color') {
        painted.push({ sel: `${t.tag}${t.cls ? '.' + t.cls : ''}`, prop, native: n[prop], themed: t[prop] });
      }
    }
  }

  const dedupe = (arr) => {
    const m = new Map();
    for (const x of arr) {
      const k = `${x.sel}|${x.prop}|${x.native}->${x.themed}`;
      if (!m.has(k)) m.set(k, { ...x, count: 0 });
      m.get(k).count++;
    }
    return [...m.values()].sort((a, b) => (b.nativeChroma || 0) - (a.nativeChroma || 0)).slice(0, 30);
  };

  const out = {
    url: page.url(),
    counts: {},
    flattened: dedupe(flattened),
    painted: dedupe(painted),
  };
  out.counts.flattened = out.flattened.length;
  out.counts.painted = out.painted.length;
  out.counts.elementsCompared = themed.length;
  out.summary = `audit-chroma ${out.counts.elementsCompared} els :: flattened=${out.counts.flattened} painted=${out.counts.painted}`;
  return out;
}
