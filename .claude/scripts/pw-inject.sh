#!/usr/bin/env bash
# pw-inject.sh <session> <user.css> — inject a theme's inner rules into a live
# playwright-cli session (top page + same-origin iframes; cross-origin frames skipped).
# Unwraps EVERY @-moz-document block (Chromium ignores the at-rule, so wrapped rules
# would silently not apply) and drops the ==UserStyle== header / anything between blocks.
# Read from disk, so the CSS never enters the agent's token context.
# Per frame: try addStyleTag (real <style>), falling back to a constructable
# adoptedStyleSheets sheet if it throws (CSP) or hangs past PW_INJECT_TIMEOUT_MS.
set -u
session="${1:?usage: pw-inject.sh <session> <user.css>}"
css="${2:?usage: pw-inject.sh <session> <user.css>}"
timeout_ms="${PW_INJECT_TIMEOUT_MS:-2500}"   # per-frame addStyleTag budget before fallback
[ -f "$css" ] || { echo "FAIL: no such file: $css" >&2; exit 2; }
tmp_css="$(mktemp "${TMPDIR:-/tmp}/pw-inner.XXXXXX")"   # trailing X's (BSD/GNU portable)
tmp_js="$(mktemp "${TMPDIR:-/tmp}/pw-inject.XXXXXX").js"
# Unwrap all @-moz-document blocks (brace-counted) into tmp_css, then build the
# run-code body: embed the stripped CSS (as a JS string, for the fallback) and
# the temp file path (for addStyleTag). node + JSON.stringify keeps quoting safe.
node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  // Concatenate the inner rules of every top-level @-moz-document block.
  // No block found = already-inner CSS, pass through unchanged.
  // Braces and the at-rule token only count outside strings and comments: a
  // regexp() prelude can hold a {n} quantifier, a declaration can hold a brace
  // in a string, and a comment can mention @-moz-document. Treating any of
  // those as structural silently truncates or discards the whole sheet.
  // Quote chars via charCode: this program sits in a single-quoted shell string.
  const DQ = String.fromCharCode(34), SQ = String.fromCharCode(39);
  const skip = (s, i) => {
    const c = s[i];
    if (c === DQ || c === SQ) {
      for (i++; i < s.length; i++) {
        if (s[i] === "\\") i++;
        else if (s[i] === c) return i + 1;
      }
      return s.length;                       // unterminated string: consume rest
    }
    if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      return end === -1 ? s.length : end + 2;
    }
    return i;                                // not a string or comment
  };
  const AT = "@-moz-document";
  let out = "", found = false, i = 0;
  while (i < raw.length) {
    const k = skip(raw, i);
    if (k !== i) { i = k; continue; }
    if (!raw.startsWith(AT, i)) { i++; continue; }
    let j = i + AT.length, open = -1;
    while (j < raw.length) {                 // opening brace, past the prelude
      const k2 = skip(raw, j);
      if (k2 !== j) { j = k2; continue; }
      if (raw[j] === "{") { open = j; break; }
      j++;
    }
    if (open === -1) break;                  // malformed: no block to unwrap
    found = true;
    let depth = 1;
    j = open + 1;
    while (j < raw.length && depth > 0) {
      const k2 = skip(raw, j);
      if (k2 !== j) { j = k2; continue; }
      if (raw[j] === "{") depth++;
      else if (raw[j] === "}") depth--;
      j++;
    }
    out += raw.slice(open + 1, depth === 0 ? j - 1 : j) + "\n";
    i = j;
  }
  const css = found ? out : raw;
  // Both failures below inject cleanly and do nothing, so without a warning they
  // read as "the theme has no effect" — i.e. as a dead incumbent.
  const pre = /@preprocessor\s+([a-z]+)/i.exec(raw);
  if (pre && pre[1] !== "default" && pre[1] !== "uso") {
    console.error("WARN: @preprocessor " + pre[1] + " — source is not plain CSS, injected rules will not apply");
  }
  if (raw.length > 500 && css.length * 10 < raw.length) {
    console.error("WARN: unwrapped " + raw.length + "B -> " + css.length + "B (<10%) — check the @-moz-document prelude");
  }
  fs.writeFileSync(process.argv[2], css);
  const cssPath = process.argv[2];
  const timeout = Number(process.argv[3]);
  const body = `async p => {
    const CSS = ${JSON.stringify(css)};
    const PATH = ${JSON.stringify(cssPath)};
    const T = ${timeout};
    let ok = 0, fb = 0;
    for (const f of p.frames()) {
      let applied = false;
      try {
        const r = await Promise.race([
          f.addStyleTag({ path: PATH }).then(() => "ok", () => "err"),
          p.waitForTimeout(T).then(() => "timeout"),
        ]);
        if (r === "ok") { applied = true; ok++; }
      } catch (e) {}
      if (!applied) {
        try {
          await f.evaluate((c) => {
            const s = new CSSStyleSheet();
            s.replaceSync(c);
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
          }, CSS);
          fb++;
        } catch (e) {}
      }
    }
    return "injected: " + ok + " via <style>, " + fb + " via adoptedStyleSheets (fallback)";
  }`;
  fs.writeFileSync(process.argv[4], body);
' "$css" "$tmp_css" "$timeout_ms" "$tmp_js" \
  || { echo "FAIL: could not build inject payload" >&2; rm -f "$tmp_css" "$tmp_js"; exit 3; }
npx playwright-cli -s="$session" run-code --filename="$tmp_js"
rc=$?
rm -f "$tmp_css" "$tmp_js"
exit $rc
