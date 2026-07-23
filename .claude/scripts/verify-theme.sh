#!/usr/bin/env bash
# verify-theme.sh <site> — ship gate for a userstyle theme.
# Exit 0 = all gates pass. Non-zero = at least one failure (printed).
set -u
site="${1:?usage: verify-theme.sh <site>}"
root="$(git rev-parse --show-toplevel)"
user="$root/themes/$site/$site.user.css"
org="$root/themes/$site/$site.org.css"
docs="$root/themes/$site/docs"
fail=0

[ -f "$user" ] || { echo "FAIL: missing $user"; exit 2; }
[ -f "$org" ]  || { echo "FAIL: missing $org"; exit 2; }

# 1. brace balance, both files
for f in "$user" "$org"; do
  o=$(grep -o '{' "$f" | wc -l | tr -d ' '); c=$(grep -o '}' "$f" | wc -l | tr -d ' ')
  [ "$o" = "$c" ] || { echo "FAIL: brace imbalance in $(basename "$f") ($o/$c)"; fail=1; }
done

# 2. .org.css sanitization — check CODE ONLY.
#
# Comments are stripped first. Grepping the raw file makes any comment that merely
# NAMES a forbidden construct fail the gate: on 2026-07-10 a comment reading
# "the previous :not(:has(iframe)) guard" failed sanitization on a file whose code
# was clean, and a promoter (correctly) refused to stamp the bundle. The parser does
# not care what a comment says; neither should this check.
#
# Line numbers are preserved by replacing each comment with an equal number of
# newlines, so a real violation still reports its true line.
strip_comments() {
  perl -0777 -pe 's{/\*(.*?)\*/}{ my $c = $1; my $n = ($c =~ tr/\n//); "\n" x $n }ges' "$1"
}
org_code="$(strip_comments "$org")"

bad='" i\]|:has\(|:is\(|:where\(|oklch|color-mix|@layer|@container'
if printf '%s' "$org_code" | grep -nE "$bad" >/dev/null; then
  echo "FAIL: .org.css unsanitized syntax:"; printf '%s' "$org_code" | grep -nE "$bad"; fail=1
fi
if printf '%s' "$org_code" | grep -nE ':not\([^)]* [^)]*\)' >/dev/null; then
  echo "FAIL: .org.css complex :not():"; printf '%s' "$org_code" | grep -nE ':not\([^)]* [^)]*\)'; fail=1
fi

# 3. @version present in user.css only
grep -qE '^@version' "$user" || { echo "FAIL: no @version in user.css"; fail=1; }
grep -qE '^@version' "$org"  && { echo "FAIL: @version present in org.css"; fail=1; }

# 3b. the CSS must actually PARSE.
#
# A rule can be present in the file and absent from the browser: a `*/` inside comment
# prose truncates the sheet (ozon: 3 of 40 rules parsed), and a selector list mixing
# ::-webkit- with ::-moz- is invalid in BOTH engines so the whole rule is discarded.
# grep, brace balance and the mirror diff all pass on
# these. Only the CSSOM knows. Skips silently if playwright isn't installed.
if [ -f "$root/.claude/scripts/parse-check.js" ]; then
  if ! node "$root/.claude/scripts/parse-check.js" "$site" >/tmp/parse-check-$$.txt 2>&1; then
    echo "FAIL: $site has rules that do not survive the CSS parser:"
    sed 's/^/      /' /tmp/parse-check-$$.txt
    fail=1
  fi
fi

# 4. bundle artifacts must exist
if ! ls "$docs"/promo-*.png >/dev/null 2>&1; then
  echo "FAIL: no promos in $docs"; fail=1
fi

if [ ! -f "$docs/walkthrough.mp4" ]; then
  echo "FAIL: missing walkthrough.mp4 in $docs — record it"; fail=1
elif [ ! -s "$docs/walkthrough.mp4" ]; then
  echo "FAIL: walkthrough.mp4 is empty (0 bytes) — re-record it"; fail=1
else
  # must be a REAL MP4, not a WebM with a .mp4 extension
  # (playwright-cli records WebM; it won't open in QuickTime/native players unless transcoded)
  file -b "$docs/walkthrough.mp4" | grep -qi webm && { echo "FAIL: walkthrough.mp4 is actually WebM — transcode to H.264 MP4 (ffmpeg -c:v libx264 -movflags +faststart)"; fail=1; }
fi

# 5. bundle freshness — CONTENT hash, not mtime.
#
# theme-promoter writes docs/.bundle-hash (the css-hash of the .user.css it captured
# from) as its last action. If the stylesheet's RULES have changed since, the bundle is
# stale no matter what the mtimes say. This is strictly better than the old `-nt` test
# in both directions: a comment/@version edit no longer invalidates 10 promos + a video,
# and a rule edit can no longer hide behind a `touch`-fresh artifact.
#
# A MISSING stamp is a hard FAIL. It used to WARN and fall back to an mtime test, so a
# promoter that skipped its final step degraded the gate SILENTLY rather than loudly —
# five did exactly that on 2026-07-10, and the mtime fallback passed several of them.
# Every theme now carries a stamp, so the fallback is gone. `.bundle-hash` is the only
# thing that certifies a bundle, and writing it must be the promoter's last action.
hashfile="$docs/.bundle-hash"
if [ ! -f "$hashfile" ]; then
  echo "FAIL: no $docs/.bundle-hash — the bundle is NOT certified"
  echo "      theme-promoter must write it as its LAST action:"
  echo "        printf '%s\\n' \"\$(bash .claude/scripts/css-hash.sh $user)\" > $hashfile"
  fail=1
else
  cur="$(bash "$root/.claude/scripts/css-hash.sh" "$user")"
  rec="$(tr -d '[:space:]' < "$hashfile")"
  if [ "$cur" != "$rec" ]; then
    echo "FAIL: bundle is stale — $site.user.css rules changed since capture"
    echo "      captured: $rec"
    echo "      current:  $cur"
    echo "      → re-dispatch theme-promoter (promos + walkthrough.mp4)"
    fail=1
  fi
fi

[ "$fail" = 0 ] && echo "OK: $site passes all gates"
exit "$fail"
