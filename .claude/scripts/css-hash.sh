#!/usr/bin/env bash
# css-hash.sh <file.css> — content hash of a stylesheet's RULES.
#
# Strips comments and normalises whitespace before hashing, so the hash tracks what
# the browser actually RENDERS, not the bytes on disk. Consequences, both deliberate:
#
#   * A comment-only edit, a reflow, or an `@version`/`@description` bump does NOT
#     change the hash. (The UserStyle metadata header is a CSS comment.) Promos stay
#     valid — no needless re-shoot. The old mtime gate invalidated 10 promos + a video
#     for a typo fix in a comment.
#   * ANY change to a selector, property, or value DOES change the hash, so a stale
#     bundle can never certify green.
#
# Used by theme-promoter (writes docs/.bundle-hash after capture) and verify-theme.sh
# (compares it). See also: the mtime gate could not tell a rule change from a comment.
set -eu
f="${1:?usage: css-hash.sh <file.css>}"
[ -f "$f" ] || { echo "css-hash: no such file: $f" >&2; exit 2; }

_md5() { if command -v md5 >/dev/null 2>&1; then md5 -q; else md5sum | cut -d' ' -f1; fi; }

perl -0777 -pe 's{/\*.*?\*/}{}gs' "$f" \
  | tr -s ' \t\n\r' ' ' \
  | sed -e 's/ *\([{};:,>~+]\) */\1/g' -e 's/^ *//' -e 's/ *$//' \
  | _md5
