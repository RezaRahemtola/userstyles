#!/usr/bin/env bash
# check-stale-promos.sh — Stop hook. WARNS (never modifies) on stale promos.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
stale=()
for user in "$root"/themes/*/*.user.css; do
  [ -f "$user" ] || continue
  dir="$(dirname "$user")"; site="$(basename "$dir")"
  ls "$dir"/docs/promo-*.png >/dev/null 2>&1 || continue
  for p in "$dir"/docs/promo-*.png; do
    [ "$user" -nt "$p" ] && { stale+=("$site"); break; }
  done
done
if [ ${#stale[@]} -gt 0 ]; then
  printf '{"systemMessage":"⚠ Stale promos (CSS newer than promos): %s — run a theme-promoter before shipping."}\n' "$(IFS=,; echo "${stale[*]}")"
fi
exit 0
