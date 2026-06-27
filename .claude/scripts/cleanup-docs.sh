#!/usr/bin/env bash
# cleanup-docs.sh [site] [--apply] — remove scratch files from themes/<site>/docs/,
# keeping only the ship bundle. Dry-run by default; pass --apply to delete.
#
# KEEPERS (everything else in docs/ is removed):
#   promo-*            listing promo shots (.png + -org.jpg)
#   incumbent-*        opportunity / incumbent render-test evidence (cited by rationale.md)
#   walkthrough.mp4    walkthrough video
#   listing.md         submission copy
#   rationale.md       demand evidence write-up
#
# Removed = review-*, verify-*, baseline-*, and any other scratch an agent left behind.
set -u
root="$(git rev-parse --show-toplevel)"
apply=0; site=""
for a in "$@"; do
  case "$a" in
    --apply) apply=1 ;;
    -*) echo "unknown flag: $a" >&2; exit 2 ;;
    *) site="$a" ;;
  esac
done

if [ -n "$site" ]; then
  dirs=("$root/themes/$site/docs")
else
  dirs=()
  for d in "$root"/themes/*/docs; do [ -d "$d" ] && dirs+=("$d"); done
fi

removed=0; kept=0
for docs in "${dirs[@]}"; do
  [ -d "$docs" ] || { echo "skip: no $docs" >&2; continue; }
  for f in "$docs"/*; do
    [ -e "$f" ] || continue
    b="$(basename "$f")"
    case "$b" in
      promo-*|incumbent-*|walkthrough.mp4|listing.md|rationale.md)
        kept=$((kept+1)) ;;
      *)
        removed=$((removed+1))
        # keepers are always flat files; any leftover file OR subdirectory is scratch
        if [ "$apply" = 1 ]; then rm -rf "$f"; echo "rm   ${f#"$root"/}"; else echo "WOULD rm  ${f#"$root"/}"; fi ;;
    esac
  done
done

echo
if [ "$apply" = 1 ]; then echo "done: removed $removed, kept $kept"
else echo "dry-run: $removed would be removed, $kept kept — re-run with --apply to delete"; fi
