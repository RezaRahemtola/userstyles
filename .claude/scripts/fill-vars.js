#!/usr/bin/env node
/**
 * fill-vars.js <file|-> [--keep-moz] [--report] — make a scraped incumbent style
 * injectable, so a render test measures what a real user sees.
 *
 *   curl -s https://userstyles.world/api/style/19260.user.css > inc.css
 *   node .claude/scripts/fill-vars.js inc.css > filled.css
 *   node .claude/scripts/fill-vars.js inc.css --report   # what it found, no CSS
 *
 * ---------------------------------------------------------------------------
 * WHY: an unfilled parametric style renders LIGHT and reads as a dead incumbent.
 * ---------------------------------------------------------------------------
 * A UserCSS author writes `@var color bg "Background" #111` and then `var(--bg)`
 * in the body. Stylus SYNTHESIZES a `:root { --bg: #111 }` block from those
 * defaults at install time — that block is nowhere in the file. Scrape the CSS,
 * inject it raw, and every var() resolves to nothing: the page stays light, the
 * coverage scan reads ~unchanged, and the incumbent looks broken when it is fine.
 *
 * That is a false negative in the expensive direction — it says "unserved lane,
 * build it" about a site that is already served. Registry case: Walmart id19260
 * measures 95%->95% light raw and 95%->0% with vars filled. It works. Don't build.
 *
 * The `uso` preprocessor spells the same thing `/*[[bg]]*\/` and `@advanced`.
 *
 * Both forms are handled here. Also unwraps @-moz-document, which Chrome does not
 * implement: left in place, every rule inside it is inert and the test measures an
 * empty stylesheet. --keep-moz disables that.
 *
 * Parse the value forms with a real parser or you invent rot: a naive
 * "default = rest of the line" filler emits `--p-background-base::;` for the
 * select-BLOCK form and passes `[20,10,30,1,"px"]` through verbatim as a length.
 */
'use strict';

const fs = require('fs');

/** Metadata block is the first ==UserStyle== comment; vars only count inside it. */
function metaBlock(css) {
  const m = css.match(/\/\*\s*==UserStyle==([\s\S]*?)==\/UserStyle==\s*\*\//);
  return m ? { body: m[1], raw: m[0] } : null;
}

/**
 * Split a `@var`/`@advanced` line into its four parts, honouring quotes and
 * brackets so a label containing spaces (or a value containing anything) survives.
 * Returns { type, name, label, rest } with `rest` unparsed.
 */
function splitDecl(line) {
  const m = line.match(/^@(var|advanced)\s+(\S+)\s+(\S+)\s+/);
  if (!m) return null;
  let i = m[0].length;
  let label = '';
  if (line[i] === '"' || line[i] === "'") {
    const q = line[i++];
    for (; i < line.length && line[i] !== q; i++) {
      if (line[i] === '\\') label += line[i++];
      label += line[i];
    }
    i++;
  } else {
    while (i < line.length && !/\s/.test(line[i])) label += line[i++];
  }
  return { kind: m[1], type: m[2], name: m[3], label, rest: line.slice(i).trim() };
}

/** Read one balanced {...} or [...] starting at `from`; returns [text, endIndex]. */
function balanced(s, from) {
  const open = s[from];
  const close = open === '{' ? '}' : ']';
  let depth = 0, q = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return [s.slice(from, i + 1), i + 1];
  }
  return [s.slice(from), s.length];
}

function unquote(s) {
  s = s.trim();
  return /^(["'`])[\s\S]*\1$/.test(s) ? s.slice(1, -1) : s;
}

/** Read a quoted string at `i` — " ' or ` . Returns [text, endIndex] or null. */
function readQuoted(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let out = '';
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') { out += s[++i] ?? ''; continue; }
    if (s[i] === q) return [out, i + 1];
    out += s[i];
  }
  return [out, s.length];
}

/**
 * Tokenize a select/dropdown object body into key/value pairs.
 * The key is `identifier:Label` INSIDE one quoted string, so it contains a colon —
 * a regex that treats the first colon as the separator drops every pair. Values may
 * be backtick-quoted (data-URIs routinely are).
 */
function objectPairs(inner) {
  const pairs = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;

    let key, r;
    if ((r = readQuoted(inner, i))) { [key, i] = r; }
    else { const st = i; while (i < inner.length && inner[i] !== ':') i++; key = inner.slice(st, i).trim(); }

    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (inner[i] !== ':') { while (i < inner.length && inner[i] !== ',') i++; continue; }
    i++;
    while (i < inner.length && /\s/.test(inner[i])) i++;

    let value;
    if ((r = readQuoted(inner, i))) { [value, i] = r; }
    else {
      const st = i;
      let depth = 0;
      while (i < inner.length && (depth > 0 || inner[i] !== ',')) {
        if (inner[i] === '(') depth++;
        else if (inner[i] === ')') depth--;
        i++;
      }
      value = inner.slice(st, i).trim();
    }
    pairs.push({ key, value });
  }
  return pairs;
}

/**
 * Resolve a declaration's DEFAULT value.
 *
 * select/dropdown mark the default with a trailing `*` on the key (or on the bare
 * option); with none marked it is the first. range/number are
 * [default, min, max, step, units?] and the units are part of the value.
 */
function defaultValue(d) {
  const t = d.type.toLowerCase();
  const rest = d.rest;

  if (t === 'select' || t === 'dropdown') {
    if (rest[0] === '{') {
      const [block] = balanced(rest, 0);
      const inner = block.slice(1, -1);
      // Object form: 'key:Label': 'value' — a trailing `*` on the key marks the default.
      const pairs = objectPairs(inner);
      if (pairs.length) {
        const star = pairs.find((p) => /\*$/.test(p.key.trim()));
        return (star || pairs[0]).value;
      }
      // uso @advanced dropdown: key "Label" <<<EOT value EOT;
      const eot = [...inner.matchAll(/<<<EOT([\s\S]*?)EOT\s*;/g)].map((x) => x[1].trim());
      if (eot.length) return eot[0];
      return null;
    }
    if (rest[0] === '[') {
      const [block] = balanced(rest, 0);
      const opts = block
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s))
        .filter((s) => s !== '');
      if (!opts.length) return null;
      const star = opts.find((o) => /\*$/.test(o));
      return (star || opts[0]).replace(/\*$/, '');
    }
    return unquote(rest.split(/\s+/)[0] || '') || null;
  }

  if (t === 'range' || t === 'number') {
    if (rest[0] === '[') {
      const [block] = balanced(rest, 0);
      const parts = block.slice(1, -1).split(',').map((s) => s.trim());
      const num = unquote(parts[0] ?? '');
      const units = parts.length >= 5 ? unquote(parts[4]) : '';
      return num === '' ? null : num + units;
    }
    return unquote(rest) || null;
  }

  if (t === 'checkbox') return unquote(rest) === '1' ? '1' : '0';

  // color / text / image / anything else: a bare or quoted scalar.
  if (rest[0] === '{' || rest[0] === '[') {
    const [block] = balanced(rest, 0);
    return block; // structured default we don't model; keep it verbatim
  }
  return unquote(rest) || null;
}

/**
 * Scan by INDEX, never by line: a select/dropdown default is a brace block that
 * spans lines, and re-locating a trimmed line with indexOf silently drops it.
 * Later declarations of one name win, matching CSS and the duplicate :root
 * blocks these styles ship.
 */
function parseVars(css) {
  const meta = metaBlock(css);
  if (!meta) return { vars: [], meta: null };
  const body = meta.body;
  const found = new Map();
  const re = /@(?:var|advanced)\s/g;
  let m;
  while ((m = re.exec(body))) {
    const start = m.index;
    const nl = body.indexOf('\n', start);
    const firstLine = body.slice(start, nl === -1 ? body.length : nl);
    const brace = firstLine.search(/[{[]/);

    let decl;
    if (brace === -1) {
      decl = firstLine.trimEnd();
    } else {
      const [block, end] = balanced(body, start + brace);
      decl = firstLine.slice(0, brace) + block;
      re.lastIndex = Math.max(re.lastIndex, end);
    }

    const d = splitDecl(decl.replace(/^\s*\*?\s?/, ''));
    if (!d) continue;
    const value = defaultValue(d);
    if (value === null) continue;
    found.set(d.name, { name: d.name, type: d.type, value });
  }
  return { vars: [...found.values()], meta };
}

/** Chrome does not implement @-moz-document; its rules are inert until unwrapped. */
function unwrapMoz(css) {
  let out = '', i = 0, n = 0;
  for (;;) {
    const at = css.indexOf('@-moz-document', i);
    if (at === -1) { out += css.slice(i); break; }
    const brace = css.indexOf('{', at);
    if (brace === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const [block, end] = balanced(css, brace);
    out += block.slice(1, -1);
    i = end;
    n++;
  }
  return { css: out, unwrapped: n };
}

function fill(css, { keepMoz = false } = {}) {
  const { vars, meta } = parseVars(css);
  let body = meta ? css.replace(meta.raw, '') : css;

  // uso placeholders resolve to the same defaults.
  let placeholders = 0;
  for (const v of vars) {
    const re = new RegExp(`/\\*\\[\\[${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]\\*/`, 'g');
    body = body.replace(re, () => { placeholders++; return v.value; });
  }

  let unwrapped = 0;
  if (!keepMoz) ({ css: body, unwrapped } = unwrapMoz(body));

  const root = vars.length
    ? `:root {\n${vars.map((v) => `  --${v.name}: ${v.value};`).join('\n')}\n}\n\n`
    : '';
  return { css: root + body, vars, placeholders, unwrapped };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const keepMoz = args.includes('--keep-moz');
  const report = args.includes('--report');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: fill-vars.js <file|-> [--keep-moz] [--report]');
    process.exit(2);
  }
  const src = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  const r = fill(src, { keepMoz });
  if (report) {
    console.log(`vars        : ${r.vars.length}`);
    for (const v of r.vars) console.log(`  --${v.name} (${v.type}) = ${v.value}`);
    console.log(`placeholders: ${r.placeholders} substituted`);
    console.log(`@-moz-document: ${keepMoz ? 'kept' : `${r.unwrapped} unwrapped`}`);
  } else {
    process.stdout.write(r.css);
  }
}

module.exports = { fill, parseVars, unwrapMoz };
