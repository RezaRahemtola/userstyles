#!/usr/bin/env node
/**
 * parse-check.js <site> [...] — prove a theme's CSS actually PARSES.
 *
 *   node .claude/scripts/parse-check.js pepper
 *   node .claude/scripts/parse-check.js            # every theme
 *
 * Exit 0 = every rule survives the CSS parser. Exit 1 = at least one rule does not
 * exist at runtime. Called by verify-theme.sh.
 *
 * ---------------------------------------------------------------------------
 * WHY: a rule can be present in the file and absent from the browser.
 * ---------------------------------------------------------------------------
 * Nothing else we have can see this. `grep` finds the selector, brace balance is
 * fine, the .user.css/.org.css mirror diff matches, and verify-theme.sh exits 0 —
 * while the rule does not exist. Two ways it happens, both found shipped on
 * 2026-07-10:
 *
 *   1. A COMMENT-TERMINATOR INSIDE COMMENT PROSE closes the comment early; the parser
 *      then drops every rule after it. ozon's sheet parsed 3 of 40 rules. Naming two
 *      wildcarded tokens back to back (think "--text" star, slash, "--graphic" star)
 *      is enough to do it. This very file tripped it while being written.
 *
 *   2. A MIXED-VENDOR SELECTOR LIST. If any selector in a comma list is invalid,
 *      CSS discards the WHOLE rule (unlike :is(), which forgives). So
 *          input::-webkit-slider-runnable-track,
 *          input::-moz-range-track { ... }
 *      is dead in Chromium (rejects -moz-) AND in Firefox (rejects -webkit-).
 *      pepper's price-slider track was unstyled in every browser. Split by engine.
 *
 * A pure `-moz-` / `-ms-` rule legitimately fails to parse in Chromium — it is valid
 * in its own engine. Those are EXPECTED and reported as `firefoxOnly`, not failures.
 * A rule that mixes engines is a failure, because no engine accepts it.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
let chromium;
try {
  ({ chromium } = require(path.join(root, 'node_modules', 'playwright')));
} catch (e) {
  console.error('parse-check: playwright not found in node_modules — skipping (not a failure)');
  process.exit(0);
}

// Chromium ignores @-moz-document, so peel the wrappers before injecting.
function unwrap(css) {
  let s = css.replace(/\/\*[\s\S]*?==\/UserStyle==[\s\S]*?\*\//, '');
  let out = '', last = 0, m;
  const re = /@-moz-document[^{]*\{/g;
  while ((m = re.exec(s))) {
    out += s.slice(last, m.index);
    let depth = 1, i = re.lastIndex;
    while (i < s.length && depth > 0) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
    out += s.slice(re.lastIndex, i - 1);
    last = i; re.lastIndex = i;
  }
  return out + s.slice(last);
}

// split a stylesheet into its top-level rule texts (prelude + block)
function topRules(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) {
        let p = start - 1;
        while (p >= 0 && s[p] !== '}' && s[p] !== ';') p--;
        const text = s.slice(p + 1, i + 1).trim();
        if (text) rules.push(text);
      }
    }
  }
  return rules;
}

const VENDOR_MOZ = /(::|:)-moz-/;
const VENDOR_MS = /(::|:)-ms-/;
const VENDOR_WEBKIT = /(::|:)-webkit-/;

function prelude(rule) { return rule.slice(0, rule.indexOf('{')); }

// A stray `*/` in prose: a `*/` whose preceding char is neither whitespace nor `*`.
function strayCommentTerminators(raw) {
  const hits = [];
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] === '*' && raw[i + 1] === '/') {
      const prev = raw[i - 1];
      if (!/\s/.test(prev) && prev !== '*') hits.push(raw.slice(0, i).split('\n').length);
    }
  }
  return hits;
}

(async () => {
  let sites = process.argv.slice(2);
  if (!sites.length) {
    sites = fs.readdirSync('themes').filter(d => fs.existsSync(`themes/${d}/${d}.user.css`)).sort();
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body></body></html>');

  let failed = 0;
  for (const site of sites) {
    for (const kind of ['user', 'org']) {
      const p = `themes/${site}/${site}.${kind}.css`;
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');

      const stray = strayCommentTerminators(raw);
      if (stray.length) {
        console.log(`FAIL: ${p} — stray '*/' inside comment prose at line(s) ${stray.join(', ')}`);
        console.log(`      This closes the comment early; every rule after it is dropped.`);
        failed++;
      }

      const rules = topRules(unwrap(raw));
      const dead = [];
      let firefoxOnly = 0;
      for (const r of rules) {
        const n = await page.evaluate((cssText) => {
          const st = document.createElement('style');
          st.textContent = cssText;
          document.head.appendChild(st);
          const c = st.sheet ? st.sheet.cssRules.length : -1;
          st.remove();
          return c;
        }, r);
        if (n === 1) continue;
        const pre = prelude(r);
        const w = VENDOR_WEBKIT.test(pre), z = VENDOR_MOZ.test(pre), i = VENDOR_MS.test(pre);
        if ((z || i) && !w) { firefoxOnly++; continue; }   // valid in its own engine
        dead.push({ n, pre: pre.replace(/\s+/g, ' ').trim().slice(0, 110) });
      }
      if (dead.length) {
        failed++;
        console.log(`FAIL: ${p} — ${dead.length} rule(s) parse to nothing in ANY engine:`);
        for (const d of dead) {
          const mixed = VENDOR_WEBKIT.test(d.pre) && (VENDOR_MOZ.test(d.pre) || VENDOR_MS.test(d.pre));
          console.log(`      [parsed=${d.n}]${mixed ? ' MIXED-VENDOR LIST — split by engine:' : ''} ${d.pre}`);
        }
      } else if (!stray.length) {
        console.log(`ok  : ${p} — ${rules.length} rules parse${firefoxOnly ? ` (${firefoxOnly} firefox-only, expected)` : ''}`);
      }
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
