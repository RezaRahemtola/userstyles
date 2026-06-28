---
name: userstyles-bundle
description: Produce a userstyle theme's ship bundle — framed promos, ≤160-char user-facing listing.md, the sanitized .org.css, and the @version bump rules. Load when generating or regenerating a theme's review bundle.
---

## Bundle layout

All in `themes/<site>/docs/`. These are the **only** keepers — `/theme-cleanup` removes anything else in `docs/` as scratch, so opportunity/proof images you want to keep MUST use the `incumbent-*` prefix and be cited by `rationale.md`:
- `promo-*.png` — 2× viewport shots (1280×800 logical, deviceScaleFactor:2)
- `promo-*-org.jpg` — compressed version for any promo >700 KB (see org.jpg recipe below)
- `listing.md` — submission copy (Name, Description, optional Features block)
- `rationale.md` — demand evidence + verdict; cites the `incumbent-*` evidence shots (don't cite scratch like `verify-*`/`review-*` — those get cleaned)
- `incumbent-*.png/.jpg` — incumbent render-test + unstyled-baseline evidence images (the opportunity proof)
- `walkthrough.mp4` — smooth-scroll Playwright video

Transient review/verification shots (`review-<issue>-<before|after>.png`, `verify-*.png`) are fine to write during a build/review but are NOT bundle keepers — `/theme-cleanup` sweeps them.

## Promos

**Generate LAST, always from the FINAL complete CSS.** Never shorten or retype the CSS — inline the entire `themes/<site>/<site>.user.css` body.

**Regenerate EVERY promo showing a changed surface.** A nav/header/footer/card appears across most promos — a fix to any shared surface makes all promos showing it stale. After a fix: list which surface changed, identify every promo frame showing it, regenerate all of them.

Frame each promo to actually show what it claims (e.g. `promo-sidebar` must be scrolled to the sidebar). Kill cookie/consent banners (click the real button, not `.remove()`) and hide blank ad slots before capturing.

**org.jpg recipe (for promos >700 KB):**
```bash
sips -s format jpeg -Z 1600 -s formatOptions 72 in.png --out out-org.jpg
# If still >700 KB:
sips -s format jpeg -Z 1366 -s formatOptions 62 in.png --out out-org.jpg
```
Keep the full-res PNG for userstyles.world (no size limit). Note which file is which in `listing.md`.

## walkthrough.mp4

A smooth-scroll video of the themed site, written to `themes/<site>/docs/walkthrough.mp4`. Record with `playwright-cli` on the same injected session as the promos.

**IMPORTANT — `playwright-cli` records WebM, not MP4.** Recording straight to `walkthrough.mp4` produces a WebM-in-`.mp4` file, so ALWAYS record to a `.webm` temp, then transcode to a real H.264 MP4 with `ffmpeg`:

```bash
# --size MUST be set: video-start otherwise downscales to fit 800x800, so a
# 1280x800 viewport records at a tiny 800x500. Pin it to the full viewport.
npx playwright-cli -s="$S" video-start --size 1280x800 themes/<site>/docs/walkthrough.webm
# for each page type: goto, then scroll smoothly top→bottom
npx playwright-cli -s="$S" mousewheel 0 600   # repeat / pause between to pace it
npx playwright-cli -s="$S" video-stop

# transcode WebM → real H.264 MP4 (QuickTime-compatible, web-streamable), then drop the webm
ffmpeg -y -loglevel error -i themes/<site>/docs/walkthrough.webm \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart -an \
  themes/<site>/docs/walkthrough.mp4
rm -f themes/<site>/docs/walkthrough.webm
```

Re-record after ANY CSS change (`verify-theme.sh` fails if the `.user.css` is newer than the mp4). Same freshness rule as promos.

## listing.md

```
# <Name>

**Description:** <≤160 chars, end-user marketing copy>

## Features

- ...
```

**Description rules (≤160 chars — enforced by userstyles.world form):**
- End-user marketing copy: what the theme does FOR THEM
- English (even for non-English sites)
- NO internal/technical jargon: no palette hexes, "stable selectors", "no bright leaks", "full coverage", "WCAG 0 fails", "design tokens", "React vs legacy", "Stylus + Stylish compatible", or competitor comparisons
- Keep it to: what it is, what it does for the user, a couple user-relevant highlights
- Put extra detail in the optional Features block, not the Description

**Same clean rule for the CSS `@description`** in `<site>.user.css` — user-facing, no build/internal jargon, ideally ≤160 chars.

## .org.css generation

```bash
{ printf '/*\n  <Name> — report issues: https://github.com/rezarahemtola/userstyles/issues\n*/\n\n'; \
  awk '/^@-moz-document/{p=1} p' themes/<site>/<site>.user.css; } > themes/<site>/<site>.org.css
```

Then sanitize — the old userstyles.org parser rejects modern CSS and fails the whole upload:

**Forbidden syntax (grep + rewrite all hits):**
- `" i]` — case-insensitive attribute flag; drop the ` i` (write the substring lowercase to still match)
- `:has(` — Selectors Level 4; remove those rules from `.org.css`
- `:is(` — risky; remove or rewrite
- `:where(` — risky; remove or rewrite
- Complex `:not()` — `:not()` with a compound/descendant argument (e.g. `code:not(pre code)`) fails with "parse error on value ' '"; rewrite using prose-context selectors (`p code`, `li code`) instead. Simple `:not(.class)` / `:not(#id)` are fine.
- `oklch(` / `color-mix(` — remove or convert to hex
- `@layer` — remove
- `@container` — remove

After sanitizing, **re-check brace balance**: `grep -c '{' themes/<site>/<site>.org.css` must equal `grep -c '}' themes/<site>/<site>.org.css`.

## @version rules

- **Unpublished (never uploaded):** set to `1.0.0`; do not bump during local build/fix rounds
- **Published (has installs, in README):** bump once per re-upload (+1 patch); the on-disk `@version` should be exactly `last-published-version + 1 patch`. Don't bump again for additional local edits until the current bumped version is actually uploaded — one bump per published release, not per edit
- `.org.css` has **no @version line** (metadata header stripped; userstyles.org versions server-side)
- **No `@updateURL`** — leave absent (Reza's standing decision; world auto-updates via install URL)

## Verification

After producing the full bundle, run:
```bash
bash .claude/scripts/verify-theme.sh <site>
```
Require exit 0 before declaring the bundle done.
