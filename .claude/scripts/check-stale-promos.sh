#!/usr/bin/env bash
# check-stale-promos.sh — Stop hook. WARNS (never modifies) on stale bundles.
#
# Freshness must agree with verify-theme.sh: compare docs/.bundle-hash (stamped by
# theme-promoter from the CSS it captured) against the stylesheet's current RULE
# content. A comment or @version edit is not staleness. Themes bundled before
# .bundle-hash existed fall back to the old mtime test.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
hasher="$root/.claude/scripts/css-hash.sh"
stale=()
for user in "$root"/themes/*/*.user.css; do
  [ -f "$user" ] || continue
  dir="$(dirname "$user")"; site="$(basename "$dir")"
  ls "$dir"/docs/promo-*.png >/dev/null 2>&1 || continue

  if [ -f "$dir/docs/.bundle-hash" ] && [ -f "$hasher" ]; then
    cur="$(bash "$hasher" "$user" 2>/dev/null)" || continue
    rec="$(tr -d '[:space:]' < "$dir/docs/.bundle-hash")"
    [ -n "$cur" ] && [ "$cur" != "$rec" ] && stale+=("$site")
  else
    for p in "$dir"/docs/promo-*.png; do
      [ "$user" -nt "$p" ] && { stale+=("$site"); break; }
    done
  fi
done
if [ ${#stale[@]} -gt 0 ]; then
  printf '{"systemMessage":"⚠ Stale bundles (CSS rules changed since capture): %s — run a theme-promoter before shipping."}\n' "$(IFS=,; echo "${stale[*]}")"
fi
exit 0
