#!/usr/bin/env bash
# pw-inject.sh <session> <user.css> — inject a UserCSS theme's INNER rules into the
# live playwright-cli session: the top page AND every same-origin iframe (Stylus'
# @-moz-document applies inside same-origin frames, so we iterate p.frames(); cross-
# origin frames throw and are skipped). Strips the ==UserStyle== header + the
# @-moz-document wrapper (Chromium ignores @-moz-document, so the inner rules must be
# unwrapped) and injects via addStyleTag (Playwright's driver reads the file path).
# The CSS never enters the agent's token context.
set -u
session="${1:?usage: pw-inject.sh <session> <user.css>}"
css="${2:?usage: pw-inject.sh <session> <user.css>}"
[ -f "$css" ] || { echo "FAIL: no such file: $css" >&2; exit 2; }
tmp="$(mktemp "${TMPDIR:-/tmp}/pw-inner.XXXXXX")"   # trailing X's (BSD/GNU portable)
# remove everything up to & including the first "@-moz-document ... {", and the final "}"
perl -0777 -pe 's/^.*?\@-moz-document[^{]*\{//s; s/\}\s*\z//s' "$css" > "$tmp"
npx playwright-cli -s="$session" run-code "async p => { let n=0; for (const f of p.frames()) { try { await f.addStyleTag({ path: '$tmp' }); n++; } catch(e){} } return 'injected-into-'+n+'-frame(s)'; }"
rc=$?
rm -f "$tmp"
exit $rc
