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
  const re = /@-moz-document[^{]*\{/g;
  let m, out = "", found = false;
  while ((m = re.exec(raw))) {
    found = true;
    let depth = 1, i = re.lastIndex;
    for (; i < raw.length && depth > 0; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}") depth--;
    }
    out += raw.slice(re.lastIndex, depth === 0 ? i - 1 : i) + "\n";
    re.lastIndex = i;
  }
  const css = found ? out : raw;
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
