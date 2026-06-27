#!/usr/bin/env bash
# pw-inject.sh <session> <user.css> — inject a UserCSS theme's INNER rules into the
# live playwright-cli session page. Strips the ==UserStyle== header + the
# @-moz-document wrapper (Chromium ignores @-moz-document, so the inner rules must be
# unwrapped) and injects via addStyleTag (Playwright's driver reads the file path).
# The CSS never enters the agent's token context.
set -u
session="${1:?usage: pw-inject.sh <session> <user.css>}"
css="${2:?usage: pw-inject.sh <session> <user.css>}"
[ -f "$css" ] || { echo "FAIL: no such file: $css" >&2; exit 2; }
tmp="$(mktemp /tmp/pw-inner-XXXXXX.css)"
# remove everything up to & including the first "@-moz-document ... {", and the final "}"
perl -0777 -pe 's/^.*?\@-moz-document[^{]*\{//s; s/\}\s*\z//s' "$css" > "$tmp"
npx playwright-cli -s="$session" run-code "async p => { await p.addStyleTag({ path: '$tmp' }); return 'injected'; }"
rc=$?
rm -f "$tmp"
exit $rc
