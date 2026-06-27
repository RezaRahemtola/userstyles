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

# 4. promo freshness — every promo newer than user.css
if ! ls "$docs"/promo-*.png >/dev/null 2>&1; then
  echo "FAIL: no promos in $docs"; fail=1
else
  for p in "$docs"/promo-*.png; do
    [ "$user" -nt "$p" ] && { echo "FAIL: $site.user.css newer than $(basename "$p") — regenerate promos"; fail=1; }
  done
fi

[ "$fail" = 0 ] && echo "OK: $site passes all gates"
exit "$fail"
