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

A smooth-scroll video of the themed site, written to `themes/<site>/docs/walkthrough.mp4`.

**Record it with `.claude/scripts/record-walkthrough.js`. Never with `playwright-cli video-start`.**

```bash
node .claude/scripts/record-walkthrough.js themes/<site>/<site>.user.css \
     themes/<site>/docs/walkthrough.mp4 <url> [url ...]
```

Env knobs are documented in the script's header: `HEADED=1` (Cloudflare sites that block headless), `CONSENT_SELECTOR`/`CONSENT_TEXT`, `DISMISS_TEXT` (timed interstitials), `HIDE_SELECTORS`, `BLOCK_EXTRA`, `SCROLL_STEPS`.

**Why the script exists** — three defects it works around, each of which shipped a bad video before it was written:
- `video-start`'s screencast attaches ABOVE the level `-s=<session>` isolates, so with other agents live **it records their pages**. Two mp4s shipped containing another agent's session on 2026-07-09. The script launches its own browser process instead, and asserts exactly one webm exists.
- Never select the output by file size or duration — the *contaminated* file was the longer one. The script takes `page.video().path()` for the page it drove.
- `addInitScript` runs where `document.documentElement` can still be null, so the sheet silently fails to attach and the page paints unstyled white frames. The script pumps `ensureStyle()` on `requestAnimationFrame`.

It also transcodes to a real H.264 MP4 — `playwright-cli` records WebM, and a WebM-in-`.mp4` won't open in QuickTime. `verify-theme.sh` rejects it.

**Then LOOK at the result.** Extract several frames (`ffmpeg -ss <t> -frames:v 1 out.mp4 f.png`) and confirm each shows your site, themed. Every automated check we have passes on a well-formed H.264 of a Cloudflare block page, because our own theme paints the interstitial dark and the brightness sweep reports it clean. Guard on `document.title`, not luminance.

**Freshness:** re-record after any change to the stylesheet's *rules*. `verify-theme.sh` compares `docs/.bundle-hash` (written by `theme-promoter` as its last action) against `css-hash.sh` of the current `.user.css`. Comment and `@version` edits no longer invalidate the bundle; any selector/property/value change does. Same rule for promos.

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
