---
name: userstyles-audits
description: The audit-blind dark-theme bug-class checklist plus the WCAG/contrast loop for verifying a userstyle theme — catches the failure classes a naive computed-background audit misses. Load when verifying or reviewing a theme.
---

# Userstyles Audit Checklist

Run this after injecting the theme. Loop until every check is clean. Never claim done without passing all checks.

## Injection

Inject the theme with `bash .claude/scripts/pw-inject.sh "$S" themes/<site>/<site>.user.css` — it unwraps every `@-moz-document` block, injects all same-origin frames, and auto-falls-back to a constructable `adoptedStyleSheets` sheet on CSP/hang (see `userstyles-browser`). Never hand-inject the theme. Before trusting any finding, confirm a LATE selector from the file actually applies (a raced/partial inject drops the back half of the CSS → phantom bugs).

---

## The scanner

ONE scanner covers every DOM-detectable class: **`.claude/scripts/audit-theme.js`**. (It was `audit-blind.js` plus a second-pass `audit-pseudo.js`; merged and renamed 2026-07-10 — a single element walk now feeds all 14 buckets. The *bug classes* are still called audit-blind classes; the *script* is the theme audit.)

```bash
npx playwright-cli -s="$S" run-code --filename=.claude/scripts/audit-theme.js
```

It returns `{ url, counts, <14 bucket arrays>, summary }`. The buckets: `lightSurfaces`, `lightBorders`, `svgWhiteFills`, `darkOnDark`, `placeholders`, `webkitFillMismatch`, `lightBgImages`, `pseudoWhite`, `pseudoText`, `gradientStops`, `symbolFills`, `smallLight`, `filledCarets`, `activeBorders`. Read the script's header for what each one means and its known false positives.

**A CLEAN RUN IS NOT EVIDENCE — it is the *start* of the review, never the end.** The scanner reads the DOM, not the pixels. Measured on the 2026-07-09 patrol: it returned `0/0/0` on slashdot's front page, story page and 404 while those three carried **six real bugs**, and on a genius 404 carrying a giant pure-black magnifier. Of slashdot's 13 confirmed bugs, exactly 2 were ever surfaced by a scan. Both ship-blockers of that entire patrol (genius blanking the lyrics column when an annotation opened; khan showing no indicator for the selected answer) were found by *looking at a rendered page*.

## The semantic scanner — run this too

`audit-theme.js` cannot see **semantics**. A `.button--danger` flattened to neutral grey, a stock gain and a stock loss painted the same grey, a selected tab that looks unselected — each is a legible dark control on a dark page, so every contrast and luminance threshold passes. This was the single dominant bug class across the 2026-07-09/10 patrols.

```bash
npx playwright-cli -s="$S" run-code --filename=.claude/scripts/audit-chroma.js
```

It snapshots the themed page, **detaches our sheet**, re-reads the native computed styles, restores the sheet, and diffs. Returns two buckets:
- `flattened` — the site painted a chromatic colour and we collapsed it to grey/transparent. **A lost signal.** Ranked by how saturated the native colour was.
- `painted` — the element was natively bare and we filled it (a blanket `* { border-color }` boxing in `border: 1px solid transparent` controls). Our deliberate dark chrome shows up here too — check each against the palette.

Validated by known-answer test: against a pre-fix CSS it reported **7 flattened** hits naming the exact gain/loss selectors; against the fixed CSS, **0**. It also caught a *half-applied* fix that had already shipped — one selector corrected while its sibling beside it was still grey.

**Limits:** it only sees the states currently rendered (open your flyouts first), and it cannot see `<canvas>` or SVG paint. A colour we *intentionally* re-tuned appears in `flattened` — verify each hit against the palette before "fixing" it.

Three things it structurally cannot do, no matter how many buckets it grows:

1. **It cannot see semantics.** A `.button--danger` flattened to neutral grey, a lost ad-disclosure tint, a disabled button that looks enabled — each is a legible dark control on a dark page, so every threshold passes. Catch these by reading the SITE's own stylesheet (`curl` it) and enumerating the modifier classes your rules may have swallowed.
2. **It cannot see a state you did not open.** Portal, annotation, and flyout nodes do not exist in the DOM until opened. Open dropdowns, overflow/share menus, tooltips, modals, and the mobile nav, then re-run.
3. **It cannot see pixels.** `<canvas>`, raster images, background sprites, and blend modes need screenshot luminance — and even that lies: our own theme paints a Cloudflare block page dark, so a brightness sweep reports it clean. Guard on `document.title`.

Re-run at 390×844 as well; a desktop-only scan misses the mobile chrome entirely.

---

## Audit-blind bug classes

These are the failure classes a naive `getComputedStyle().backgroundColor` walk CANNOT see. Check each explicitly.

### 1. Light surfaces (HTML box backgrounds)

**Detect:** scan `document.querySelectorAll('*')`, read `getComputedStyle(el).backgroundColor`. Flag any element >120×40 with near-white computed bg (all three RGB channels >200).

**Extra step — image wrappers:** do NOT skip an element just because it contains or wraps an `<img>`. Gallery stages, thumbnail tiles, and letterbox/padding areas often keep a white CONTAINER background behind the photo. The `<img>` pixel data is irrelevant; the container's `backgroundColor` is what leaks. Check image wrappers explicitly.

**Also check `backgroundImage`:** a translucent light gradient as `background-image` over a correctly-dark `background-color` washes the surface grey — the bg-color audit passes clean but the card looks grey. Read `getComputedStyle(el).backgroundImage` on large surfaces; flag any non-`none` gradient with light/translucent stops. Fix: `background-image: none !important` on the offending selector.

**Fix:** apply a dark `background-color` to the container class. For image wrappers, target the wrapper not the `<img>`.

---

### 2. SVG / canvas / CSS-gauge fills

**Why it's blind:** the DOM `background-color` walk only sees HTML boxes. It cannot see SVG `<rect>`/`<circle>`/`<path>` `fill="#fff"`, `<canvas>` painted light, or `::before`/`border-radius:50%` disc fills. These render bright-white and the audit passes clean — wunderground shipped a false "0/0/0" with a white temp-circle gauge, white SVG 10-day charts, and white dashboard-tile mini-charts.

**Detect:**
1. Scan `svg rect, svg circle, svg path, svg g[fill]` for white/near-white `fill` attribute on large elements.
2. Screenshot-luminance the chart/gauge/tile regions — mean pixel luminance <40/255 = dark, ~247 = white. This is the decisive check.
3. Check `getComputedStyle(el, '::before').backgroundColor` on gauge/badge containers (the disc is often painted by a pseudo with `border-radius:50%`).

**Fix:** target the SVG's own classes (`rect.bc-bar { fill: #161d27 }`, `svg.chart text { fill: #8b949e }`, remap `path[stroke="#1e2023"]` → light). CRITICAL DISTINCTION: a raster `<img>`, radar/map/photo must stay UNTOUCHED. An SVG CHART's chrome (plot bg, axis grid, day-band `rect`s, near-invisible dark data strokes) SHOULD be themed; its COLORED data series must be preserved verbatim. If it is a `<canvas>` you cannot theme it via CSS — document it as a known limitation; do not fake a fix.

---

### 3. `-webkit-text-fill-color` (text color audit blind spot)

**Why it's blind:** when a site sets `-webkit-text-fill-color`, that property overrides `color` for rendered text. An audit reading `getComputedStyle(el).color` sees the (perhaps already overridden) `color` value, not the RENDERED color. A `color: X !important` rule appears to win but the text stays its original hue.

**Detect:** read `getComputedStyle(el).webkitTextFillColor` in addition to `.color`. If it differs from `color`, it is the real rendered value. Screenshot the element to confirm what the eye sees.

**Fix:** set BOTH `color: … !important` and `-webkit-text-fill-color: … !important` on the target selector.

---

### 4. Scroll-fade "more below" `background-image` gradients

**Why it's blind:** a scrollable sidebar or list may have an overlay element whose `background-color` is `transparent` but whose `background-image: linear-gradient(transparent, white)` paints a bright strip at the bottom. The bg-color audit returns transparent (clean); the gradient survives. Also note: a transparent-neutralizer (`[class] { background-color: transparent }`) does NOT clear `background-image`, so applying a broad neutralizer does not fix this.

**Detect:** scan large elements for a non-`none` `backgroundImage` with a light gradient stop. Also screenshot-confirm the bottoms of scrollable sidebars and lists to catch the visual strip.

**Fix:** `background-image: none !important` on the overlay element (or remap the gradient stop to a dark color).

---

### 5. Pseudo-element (`::before` / `::after`) white panels and discs

**Why it's blind:** a `querySelectorAll('*')` walk reading `getComputedStyle(el).backgroundColor` CANNOT see pseudo-elements. An element can scan as fully transparent/dark yet render solid white because a full-size `::before` paints `background: #fff` behind it. Ozon's filter-rail `<aside>` wrapper painted white via `aside::before` — invisible to every element-bg audit.

**Detect:** when a screenshot shows a white surface but the element-bg scan reports 0 white elements — suspect a pseudo. Probe `getComputedStyle(el, '::before').backgroundColor` and `.backgroundColor` for `::after`, walking up from the visible white area. Trust the screenshot over the element-bg scan.

**Fix:** neutralize the pseudo within the widget scope:
```css
[data-widget="X"] *::before,
[data-widget="X"] *::after { background-color: #14181d !important; }
```
These are CSS2 selectors — safe in the old userstyles.org parser.

---

### 6. Tailwind v4 layered `!important` (`bg-white!` / `text-*!`)

**Why it's blind:** Tailwind v4 `!`-suffixed utilities (e.g. `bg-white!`) compile to `background-color: var(--color-white) !important` inside `@layer utilities`. A layered `!important` beats an unlayered `!important` regardless of selector specificity — so our injected override (Stylus/adopted sheet is unlayered) CANNOT win the `background-color` battle no matter how specific the selector. Symptom: the element stays white even with a highly-specific `!important` rule targeting it.

**Detect:** inspect the site's compiled CSS. If you see utilities like `bg-white!` or `text-gray-900!` in a `@layer utilities` block, unlayered overrides will fail for those properties.

**Fix:** redefine the CSS VARIABLE the utility resolves, scoped to the element:
```css
[data-testid="header-search"] input { --color-white: #161d27 !important; }
```
Variable resolution is layer-agnostic — the layered rule still "wins" the cascade but COMPUTES your dark value. Only `!`-suffixed utilities require this; plain `bg-white` (layered, not important) loses to our unlayered `!important` normally.

---

### 7. Placeholders and ghost-span placeholders going invisible

**Why it's blind:** a DOM text walk CANNOT see `::placeholder` pseudo-elements. A broad `input { color: #e6edf3 }` rule can accidentally paint the placeholder the same as the input background (or vice versa) → placeholder vanishes. Ghost-span patterns (e.g. Magritte `magritte-value-ghost` / `magritte-value-additional`, or an absolutely-positioned `<label>`) suffer the same way.

**Detect:** for EVERY input/textarea on every page type (hero CTA, global search, filter fields, login form): read `getComputedStyle(el, '::placeholder').color`. Also scan for absolutely-positioned span/label elements used as ghost placeholders. The placeholder must be a legible muted grey (~`#8b949e`) on the input background.

**Prove it:** take a framed screenshot showing the placeholder text actually rendered as readable text in the input — do NOT claim fixed without seeing the words in the screenshot.

**Fix:** explicit `::placeholder { color: #8b949e !important; }` rule scoped to your inputs. Ensure the typed value color and placeholder color differ enough to signal state.

---

### 8. Dark-on-dark detector

**Why it matters:** do NOT trust token-remap correctness alone. The #1 recurring miss (Udemy, session 3): muted/secondary text colored via palette tokens (`--color-gray-*`) we forgot to remap; hardcoded per-component colors; and dark text that was readable on the site's ORIGINAL light background and we only changed the background (now dark-on-dark). The contrast math can look fine if we measure the wrong background.

**Detect:** independently flag ANY text element whose own computed `color` has a relative luminance below ~0.18 (roughly darker than `#777777`) while sitting on a dark surface — regardless of what the contrast ratio math says. This catches the whole failure class at once.

**Fix:** when a site colors muted/secondary text through a palette or gray SCALE, remap the WHOLE scale (dark end → light for text, light end → dark for surfaces), not just individual semantic aliases.

---

### 9. Contrast against the REAL elevated background

**Why it matters:** cards, buyboxes, panels, and popovers sit on `#1c2128` / `#161d27`, NOT the `#14181d` base. A color that reads ~4.6:1 on the base can drop to ~4.0:1 on a card (gray-300 `#7e8893` did exactly this). Measuring contrast against the wrong ancestor is a false pass.

**Detect:** walk to the nearest OPAQUE ancestor and use THAT background for contrast measurement. Re-check the dimmest text token against the lightest elevated surface it ever lands on.

**WCAG thresholds:** contrast < 4.5 fails for normal text; < 3 fails for large text (18px+ or 14px+ bold).

**Interactive controls — ALL states:** filters, sort tabs, segmented controls, chips, dropdown/menu items, toggles — check DEFAULT/unselected, hover, selected/active, and open-menu states. A static snapshot misses the unselected state, which is the usual offender. Pikabu shipped with unreadable unselected filter labels because only one state was audited.

**Never hand-wave a WCAG fail as "intentional brand styling"** without visually confirming it is a genuine brand CTA (white-on-green button) or truly decorative non-text. Every label / filter / tab / menu-item / body / metadata text MUST pass.

---

### 10. Floating-surface opacity (bleed-through)

**Why it matters:** sticky/fixed bars, dropdown menus, popovers, autocomplete panels, modals, tooltips MUST keep a SOLID opaque background. The broad transparent-neutralizer trick (`#wrapper [class] { background: transparent }` used for hashed React apps) can blank sticky toolbars and dropdown backgrounds — content then scrolls under them and bleeds through. Thingiverse's sticky search/sort/filter bar shipped see-through this way.

**Detect:** scroll the page under sticky/fixed elements; open each dropdown, menu, and autocomplete; open any modal. Confirm content does NOT show through floating surfaces.

**Fix:** after applying any transparent neutralizer, explicitly re-establish opaque dark backgrounds on every sticky/fixed/floating surface:
```css
.sticky-bar, .dropdown-menu, [role="menu"], [role="dialog"] {
  background-color: #1c2128 !important;
}
```

---

## WCAG / contrast loop

Run AFTER the audit-blind checks above.

1. For each visible text element: measure `contrast(computedColor, effectiveBg)` where `effectiveBg` is the first OPAQUE ancestor background (not the page base if a card is in the way).
2. Flag: < 4.5 (normal text) / < 3 (large text ≥18px or ≥14px bold).
3. Report: failing selector + text color + bg color + computed ratio.
4. Fix; re-run.
5. **Loop to zero.**

---

## Coverage requirements

- **All `@-moz-document` page types** must be verified: home, search results, product/article detail, user profile, any other type the document rule claims. A theme that only looks good on one page type is incomplete.
- **Before/after computed-style diff:** snapshot key elements' `color` / `background` / `border` / icon colors on the ORIGINAL unthemed page, then themed, and diff. Change ONLY what actually changed vs. the original; map too-dark originals to a readable equivalent; keep semantic colors (status greens/reds/badges). This catches: flattened semantic colors, recolored unrelated icons, header background seams.

---

## Orchestrator self-QA

Before staging the finished theme:

1. Open the promos framed on the SPECIFIC elements previously flagged (rating lines, small metadata, the exact input the user reported) — not just the hero.
2. If a fix targets element X, the verification screenshot MUST SHOW element X fixed.
3. Do not trust "0/0/0" audit output without confirming the screenshot matches. A blocked CSP can silently leave the page unthemed; a luminance measurement confirms the theme is actually active.
