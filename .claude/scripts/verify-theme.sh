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

# 2. .org.css sanitization
bad='" i\]|:has\(|:is\(|:where\(|oklch|color-mix|@layer|@container'
if grep -nE "$bad" "$org" >/dev/null; then
  echo "FAIL: .org.css unsanitized syntax:"; grep -nE "$bad" "$org"; fail=1
fi
if grep -nE ':not\([^)]* [^)]*\)' "$org" >/dev/null; then
  echo "FAIL: .org.css complex :not():"; grep -nE ':not\([^)]* [^)]*\)' "$org"; fail=1
fi

# 3. @version present in user.css only
grep -qE '^@version' "$user" || { echo "FAIL: no @version in user.css"; fail=1; }
grep -qE '^@version' "$org"  && { echo "FAIL: @version present in org.css"; fail=1; }

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
# Themes bundled before .bundle-hash existed fall back to the mtime test and WARN.
hashfile="$docs/.bundle-hash"
if [ -f "$hashfile" ]; then
  cur="$(bash "$root/.claude/scripts/css-hash.sh" "$user")"
  rec="$(tr -d '[:space:]' < "$hashfile")"
  if [ "$cur" != "$rec" ]; then
    echo "FAIL: bundle is stale — $site.user.css rules changed since capture"
    echo "      captured: $rec"
    echo "      current:  $cur"
    echo "      → re-dispatch theme-promoter (promos + walkthrough.mp4)"
    fail=1
  fi
else
  echo "WARN: no $docs/.bundle-hash — falling back to mtime freshness (re-bundle to adopt content hashing)"
  if ls "$docs"/promo-*.png >/dev/null 2>&1; then
    for p in "$docs"/promo-*.png; do
      [ "$user" -nt "$p" ] && { echo "FAIL: $site.user.css newer than $(basename "$p") — regenerate promos"; fail=1; }
    done
  fi
  [ -f "$docs/walkthrough.mp4" ] && [ "$user" -nt "$docs/walkthrough.mp4" ] && { echo "FAIL: $site.user.css newer than walkthrough.mp4 — re-record it"; fail=1; }
fi

[ "$fail" = 0 ] && echo "OK: $site passes all gates"
exit "$fail"
