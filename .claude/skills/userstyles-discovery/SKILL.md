---
name: userstyles-discovery
description: Demand-first candidate discovery and the coverage gate for new userstyle dark themes — mine userstyles.world/.org for high-demand weak-incumbent sites, render-test incumbents (handling @var false-negatives), probe native dark, and verify buildability. Load when scouting sites to theme.
---

# Userstyles Discovery & Coverage Gate

## 0. Read the registry FIRST

Before any search, read `.claude/registry/explored.md`. Exclude every site listed there (only re-test a site if its note says to, e.g. a 🧱 WAF site once access is solved). Pass the registry to every sub-agent brief so it skips already-explored sites without a giant paste.

After each round, **append new sites + verdicts to `.claude/registry/explored.md`** (one line each: `site | verdict | demand evidence | note`).

---

## 1. Demand-first discovery

**The mainstream English pool is largely exhausted/contested.** Most high-demand English sites have a working recent dark theme or native dark already. The real wins are **regional / non-English marketplaces, classifieds, communities, and big-traffic national sites** (OLX, Avito, Vinted, Pikabu, hh.ru, niconico, Digikala). World install counts under-count regional demand (English-skewed) — weigh real in-country traffic.

**Dead/low-yield verticals:** health/medical, most ES/IT/BR/news (arXiv-style: no competition = no demand), sites that added native dark since ~2021 (German news, dev/reference sites, manga readers, Discourse forums).

### Preferred discovery methods (in order — keyword sweeps miss real winners)

**1. Full-corpus enumeration** — broad theme-name terms (dark/night/black/amoled/oled), collect EVERY result's target-site + installs + age, dedupe by site, rank by demand, gate the stale+demanded survivors. A keyword sweep only finds sites you already think of; enumeration finds Slashdot's broken 4yr theme still taking 25/wk.

**2. Non-Latin-script search** — Cyrillic is richest (тёмная/тёмный/ночной); also try 暗色/ダーク/다크/داكن/डार्क/ธีมมืด/karanlık. Themes named only in a non-Latin script are invisible to English sweeps.

**3. Comment-complaint mining** — on dark-theme pages with steady weekly installs, read comments for "broken/not working/site changed." A broken incumbent still taking installs = strong unserved-demand signal.

**4. High-install stale leaders** — browse userstyles.world `/explore` and topic searches for most-installed dark themes. Find the high-install + stale/ugly/sparse leaders (last updated 1+ yr). Those sites have proven demand with weak coverage.

Don't declare the discovery space exhausted until full-corpus enumeration + non-Latin search have been run.

---

## 2. Coverage gate — both platforms

Run for every candidate before building. Two platforms — a working theme on **either** means contested.

### (a) Demand — weekly installs, not lifetime total

Read the rendered userstyles.world **style page** (`/style/<id>`). It shows a Statistics block: "Total views / Total installs / **Weekly installs** / Weekly updates." **The API JSON does NOT expose weekly** — always read the rendered page.

- Big lifetime total + ~0 weekly = dead demand. Small total + steady weekly = live demand.
- A broken/abandoned incumbent still taking weekly installs = people actively seek a working theme → strong unserved-demand signal.
- Also weigh **sibling themes** (multiple recently-updated customization themes in the thousands = active community, even if the dark lane is empty).
- Low ceiling signal: best dark theme has tens of installs over years → skip even with zero competition (arXiv: 25 installs/2yr; Gutenberg ≤1; Craigslist 8 → all dropped).

### (b) Competition — DARK themes only

Debloat/layout/highlighter tools are NOT competitors even with high installs. Count only actual dark/night themes.

### (c) Incumbent render-test — fill @var defaults or get false negatives

Test the top few incumbents by install AND most recent — a recent working theme means demand is served.

**Pull CSS:** `fetch('https://userstyles.world/api/style/<id>.user.css')`

**CRITICAL — fill parametric vars before testing.** Many themes use `@var color foo "Label" #111` + `var(--foo)` in the body, and/or `/*[[foo]]*/` LESS placeholders (`@preprocessor uso`/`stylus`). Stylus injects a `:root{}` from defaults; the naive strip-and-inject does NOT, so `var(--…)` resolves to nothing → page stays light → LOOKS broken but actually works.

Before injecting: parse each `@var name "..." DEFAULT` → prepend `:root{ --name: DEFAULT; … }` → substitute `/*[[name]]*/` placeholders with defaults. Then inject.

Red flag: a **recently-updated incumbent testing "broken"** is almost always a var/placeholder false-negative. Re-test with defaults filled before believing it. (Walmart id 19260: 95%→95% light raw, 95%→0% light with vars filled — it works → CONTESTED.)

**Inject via constructable stylesheet** (CSP-proof):
```js
await page.evaluate((css) => {
  const s = new CSSStyleSheet(); s.replaceSync(css);
  document.adoptedStyleSheets = [s];
}, css);
```

Measure light-coverage before vs. after. Still mostly light = broken; big drop to dark = it works.

**Judge QUALITY of any working theme** (screenshot + read it). A working but crude theme (blunt invert, poor contrast) still leaves room. A polished working theme = demand served → skip (or only build if we clearly out-polish it). Skim comments for "broken / not working" complaints.

**Check .org too** (USO-Archive). Pull CSS from the raw endpoint or live userstyles.org style page. A working theme on .org also serves demand.

### (d) Native-dark — both probes required; one probe is NOT enough

A single OS probe burned us multiple times (GeeksforGeeks, WordReference).

**OS preference probe:** load in a context with `colorScheme:'dark'`. If the page goes dark, native OS-driven dark exists.

**Manual on-page toggle probe:** a toggle that ignores `prefers-color-scheme` and stores choice in `localStorage` / `data-theme` / `<html>` class looks "light, no native dark" under the OS probe but is fully self-served. Scan the UI for a dark/light/theme/mode/night switch (+ moon/sun icons), and for `data-theme`/`*dark*` classes + theme-related `localStorage` keys. Click/force it and confirm a complete dark render.

Buckets:
- **NO native dark** → real opportunity
- **Manual toggle logged-out** → SKIP (users self-serve)
- **Account-only dark** (complete native dark behind login-gated setting, no logged-out toggle) → JUDGMENT CALL: keep only if logged-out audience is real AND uncontested logged-out (Pikabu: kept; pixiv: dropped)

### (e) Buildability — meaningful pages logged-out

Verify that the pages a theme styles (search results, product/detail, article/lesson content) render anonymously — NOT just the marketing home. Sites that redirect substance to login + bot-check (Mercadolibre listings, Coursera course content) → SKIP. A login-gated sub-area (messaging/checkout/account) is fine to declare out of scope if core public pages remain themeable.

### (f) Hard WAF vs rate-limit

A hard WAF returns the block on the FIRST gentle request, consistent across UA/locale/spacing. Throttle + slow retry won't fix it. Shelve it (needs residential/in-region proxy); don't keep retrying. Examples: Etsy (Akamai/DataDome ~1488-byte stub), Shopee (server-side interstitial), sahibinden/MuseScore (Cloudflare). Don't confuse with genuine rate-limiting (first few requests succeed, then 429s).

---

## 3. Verdict legend

- 🟢 **OPPORTUNITY** — proven demand (incumbents in thousands) + weak/stale leader, no native dark, meaningful pages render logged-out → build
- 🟠 **SATURATED** — recent, high-install, good dark theme dominates → skip
- ⚪ **LOW-CEILING** — best incumbent tiny installs over years → skip (even with zero competition)
- 🧱 **WALLED / UNBUILDABLE** — hard WAF OR meaningful pages login/bot-gated → shelve, don't retry
- **NATIVE-DARK** — OS-dark or logged-out manual toggle → treat as served, skip (account-only = judgment call)
- **PORTFOLIO** — modest demand but dev-relevant (PyPI, DaFont, Khan Academy) — flag explicitly, don't inflate ceiling

---

## 4. Parser snippets

### world parser (run via `playwright-cli run-code "async p => p.evaluate(async () => { … })"`)
```js
await page.goto('https://userstyles.world/', { waitUntil: 'domcontentloaded' });
const data = await page.evaluate(async () => {
  const doc = new DOMParser().parseFromString(
    await (await fetch('/search?q=TERM', {headers:{Accept:'text/html'}})).text(), 'text/html');
  const cards = [...doc.querySelectorAll('.card, article, li')].filter(c => c.querySelector('a[href^="/style/"]'));
  const byId = new Map();
  for (const c of cards) {
    const id = c.querySelector('a[href^="/style/"]').getAttribute('href').match(/\/style\/(\d+)/)?.[1];
    if (!id || byId.has(id)) continue;
    const name = (c.querySelector('[aria-label]')?.getAttribute('aria-label')||'').replace(/ screenshot$/,'');
    const t = c.innerText.replace(/\s+/g,' ');
    byId.set(id, { id, name,
      installs:(t.match(/([\d.,]+k?)\s*installs/i)||[])[1],
      updated:(t.match(/(\d[\w ,]*?ago)/i)||[])[1] });
  }
  return [...byId.values()];
});
```

Note: **world search result names are in `aria-label`**, not link text — the thumbnail `<a href="/style/ID/">` has empty `textContent`. Parsing `textContent` silently yields 0. Strip trailing " screenshot" from the aria-label.

For the rendered style page (weekly installs): `goto('https://userstyles.world/style/<id>')`, parse the Statistics block.

### org parser (USO-Archive, client-rendered)
```js
await page.goto('https://uso.kkx.one/browse/styles?search=TERM', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(1500);
const rows = await page.evaluate(() => {
  const seen=new Set(), out=[];
  for (const a of document.querySelectorAll('a[href*="/style/"]')) {
    const h=a.getAttribute('href'); if(seen.has(h))continue; seen.add(h);
    const t=a.textContent.replace(/\s+/g,' ').trim(); if(t) out.push(t);
  }
  return out;  // "<name> By @author (id) <target> <installs> <date>"
});
```

Note: USO-Archive is **client-rendered** — `goto` then wait ~1.5s. Row text format: `"<name> By @author (id) <target> <installs> <date>"` (trailing number = total installs).

For plain `page.goto(searchURL)` returning 0: use an **in-page same-origin `fetch`** of the search HTML instead (avoids client-render race).

---

## 5. Gotchas

- **Don't declare exhausted early.** "The vein is exhausted" is almost always a method limitation. Full-corpus enumeration + non-Latin search found 3 real 🟢s after keyword rounds concluded "done." Run all methods before giving up.
- **Weekly installs > lifetime total.** A big lifetime number with ~0 weekly is dead; a small total still pulling steady weekly is live.
- **Competition = DARK only.** High-install debloaters/layout tools are irrelevant.
- **@var false-negatives.** A recently-updated incumbent that tests "broken" = almost certainly parametric vars not filled. Fill before believing.
- **Native-dark double probe.** OS probe alone missed GeeksforGeeks (manual toggle) and WordReference (manual toggle). Always do both.
- **regional demand is under-counted.** World installs are English-skewed. A national site with 500 installs may have 10M daily users who want dark.
