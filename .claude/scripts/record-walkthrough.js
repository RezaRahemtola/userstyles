#!/usr/bin/env node
/**
 * record-walkthrough.js — record a theme's walkthrough.mp4 safely.
 *
 *   node .claude/scripts/record-walkthrough.js <user.css> <out.mp4> <url> [url ...]
 *
 * Records a smooth-scroll pass over each URL with the theme injected, transcodes to
 * H.264, and verifies the result. Env overrides:
 *   HIDE_SELECTORS  extra CSS selectors to display:none (chrome you don't want on film)
 *   BLOCK_EXTRA     extra regex source OR'd into the ad/tracker abort list
 *   SCROLL_STEPS    wheel steps per page (default 26)
 *   HEADED=1        launch headed (required for Cloudflare sites that block headless)
 *   BYPASS_CSP=1    required where style-src blocks inline <style> (pypi.org): the node
 *                   attaches, `styled` reports true, and the page still paints unstyled.
 *   CONSENT_SELECTOR / CONSENT_TEXT
 *                   click a consent button in the throwaway warm context so the accept
 *                   cookie lands in storageState. Without this the CMP modal re-opens in
 *                   the recording context and its scrim trips the brightness sweep.
 *   DISMISS_TEXT    regex source; on a 400ms tick, if the page's text matches it, click the
 *                   nearest visible close/dismiss button. For TIMED interstitials that a
 *                   consent cookie cannot pre-empt — khan pops a full-viewport donation
 *                   lightbox ("Free to Use. Not Free to Make.") ~40s in, which covered the
 *                   last two stops of a take. HIDE_SELECTORS can't help when the modal's
 *                   node is hashed or it scroll-locks the body; clicking its own close
 *                   button is strictly better. Also catches first-visit onboarding tours.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS — three defects it works around
 * ---------------------------------------------------------------------------
 * 1. `browser.newContext({ recordVideo })` on the SHARED playwright-cli browser does
 *    NOT isolate. The screencast attaches above the level `-s=<session>` protects, so
 *    with other agents live you can record THEIR pages. Proven twice on 2026-07-09
 *    (genius, juejin). Fix: this script does its own `chromium.launch()` — a separate
 *    browser process that no other agent can reach.
 *
 * 2. Never select the output by file size or duration. A juejin run emitted two webms;
 *    the CONTAMINATED one (another agent's Investopedia session) was the LONGER file,
 *    so "pick the longest by Duration" would have shipped the wrong site. Always take
 *    `await page.video().path()` for the page you drove — this script asserts exactly
 *    one webm exists and fails loudly otherwise.
 *
 * 3. `addInitScript` runs at document_start, where `document.documentElement` can still
 *    be null — the <style> silently fails to attach and the page paints FULLY UNSTYLED
 *    frames until a retry fires. A slow interval (e.g. 400ms) leaves a visible white
 *    flash at every navigation. Fix: pump `ensureStyle()` on requestAnimationFrame,
 *    falling back to documentElement when <head> is missing, and RESCHEDULE IN ALL
 *    PATHS so a throw can't kill the chain. An `html { background-color }` prelude does
 *    NOT help: the whole sheet is absent, not just the canvas colour.
 *    Measured on juejin with this pump: the first 12 frames sit at 28.7 grey mean, i.e.
 *    the document_start window is already dark.
 *
 * 4. Attaching at document_start puts our <style> FIRST, so the site's later sheets win
 *    every equal-specificity `!important` tie (ties break on source order). The video then
 *    shows a bug NO REAL USER HAS — `pw-inject.sh` (promos) and Stylus (users) both append
 *    last. chefkoch: the site ships `.ds-bg-garlic { background-color: rgb(243,244,240)
 *    !important }` and the theme ships the same selector with the same specificity; on film
 *    the sponsored band rendered near-white with unreadable text, and the brightness sweep
 *    (correctly) failed the take. Fix: `ensure()` re-appends the node whenever it is not
 *    last in <head>, so our sheet always sits after the site's. Proven in-page: node last
 *    -> rgb(28,33,40); node first -> rgb(243,244,240); re-appended -> dark again.
 *    NOTE this also means a theme rule that only wins on source order is FRAGILE. The
 *    recorder now matches production, but prefer raising specificity in the theme.
 *
 * ---------------------------------------------------------------------------
 * HOW TO VERIFY THE OUTPUT (do both — a well-formed webm of the wrong site looks fine)
 * ---------------------------------------------------------------------------
 *   a) LOOK at real frames:  ffmpeg -ss <t> -frames:v 1 out.mp4 f.png   (several t)
 *      Confirm each shows YOUR site, themed.
 *   b) Luminance-sample at 0.25s (4fps). A 0.5s grid MISSES a ~0.3s flash.
 *      This script runs an every-frame (25fps) sweep automatically and fails if any
 *      frame's grey mean exceeds 100.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const { chromium } = require(path.join(REPO, 'node_modules/playwright'));

const [cssPath, outMp4, ...urls] = process.argv.slice(2);
if (!cssPath || !outMp4 || !urls.length) {
  console.error('usage: node record-walkthrough.js <user.css> <out.mp4> <url> [url ...]');
  process.exit(2);
}

const SCROLL_STEPS = Number(process.env.SCROLL_STEPS || 26);
const BRIGHT_LIMIT = 100;

// Chromium ignores @-moz-document, so unwrap every block; no block = already inner CSS.
function innerCss(raw) {
  const re = /@-moz-document[^{]*\{/g;
  let m, out = '', found = false;
  while ((m = re.exec(raw))) {
    found = true;
    let depth = 1, i = re.lastIndex;
    for (; i < raw.length && depth > 0; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') depth--;
    }
    out += raw.slice(re.lastIndex, depth === 0 ? i - 1 : i) + '\n';
    re.lastIndex = i;
  }
  return found ? out : raw;
}

const BLOCK = new RegExp(
  [
    'googletagmanager', 'google-analytics', 'doubleclick', 'googlesyndication',
    '/sentry', 'analytics\\.', 'hm\\.baidu\\.com',
    'mcs\\.zijieapi\\.com', 'log\\.snssdk\\.com',
    process.env.BLOCK_EXTRA,
  ].filter(Boolean).join('|'),
  'i'
);

function ffmpeg(args) {
  return execFileSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Bot-challenge interstitials (Cloudflare "Just a moment…" / "Performing security
// verification", DataDome). These are a SILENT killer: our own theme sets a dark
// body background, so a whole video of challenge pages sails through the brightness
// sweep AND reports styled=true. Block until the real document arrives.
const CHALLENGE_RE = /just a moment|performing security verification|attention required|checking your browser/i;
async function waitPastChallenge(pg, budgetMs = 45000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const challenged = await pg.evaluate(() => {
      const t = document.title || '';
      const re = /just a moment|performing security verification|attention required|checking your browser/i;
      return re.test(t) || !!document.querySelector('#challenge-running, .cf-turnstile, #cf-chl-widget');
    }).catch(() => false);
    if (!challenged) return true;
    await pg.waitForTimeout(1500);
  }
  return !CHALLENGE_RE.test(await pg.title().catch(() => ''));
}

// A TERMINAL block ("Sorry, you have been blocked", HTTP 403) is not a challenge:
// it carries no #challenge-running/.cf-turnstile and never clears, so
// waitPastChallenge() reports success and films it. Bursty navigation earns one
// (olx.com.br, 2026-07-09 — 7.5s of block page in an otherwise valid take).
const BLOCKED_RE = /sorry, you have been blocked|you are unable to access|verifying you are human|error 1015|access denied/i;
async function isHardBlocked(pg) {
  return pg.evaluate(re => {
    const t = `${document.title || ''}\n${(document.body && document.body.innerText || '').slice(0, 500)}`;
    return new RegExp(re, 'i').test(t);
  }, BLOCKED_RE.source).catch(() => false);
}

(async () => {
  let css = innerCss(fs.readFileSync(cssPath, 'utf8'));
  if (process.env.HIDE_SELECTORS) css += `\n${process.env.HIDE_SELECTORS} { display: none !important; }\n`;
  console.error(`inner css chars: ${css.length}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  // OWN process — see defect 1. Playwright's default `--enable-automation` sets
  // navigator.webdriver=true; Cloudflare then hard-403s every deep path (the homepage
  // still returns 200, so a shallow smoke test misses it) and the "Just a moment…"
  // interstitial NEVER self-solves. Measured on neoseeker 2026-07-09:
  //   default headed -> /persona-5/ 403, webdriver=true
  //   + disable-blink-features=AutomationControlled -> 200, webdriver=false
  const browser = await chromium.launch({
    headless: !process.env.HEADED,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // Seed cookies/consent in a throwaway context; a fresh recording context otherwise
  // re-triggers consent dialogs and they land on nearly every frame.
  const warm = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const wp = await warm.newPage();
  await wp.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await wp.waitForTimeout(2500);
  if (!(await waitPastChallenge(wp))) console.error('WARN: warm context still challenged — clearance cookie may be missing');
  if (process.env.CONSENT_SELECTOR) {
    await wp.click(process.env.CONSENT_SELECTOR, { timeout: 8000 }).catch(() => {});
    await wp.waitForTimeout(1500);
  }
  if (process.env.CONSENT_TEXT) {
    await wp.getByRole('button', { name: new RegExp(process.env.CONSENT_TEXT, 'i') })
      .first().click({ timeout: 8000 }).catch(() => {});
    await wp.waitForTimeout(1500);
  }
  // Collect a clearance cookie for EVERY origin we'll film, or the recording context
  // gets challenged mid-take and the interstitial lands on film.
  for (const origin of [...new Set(urls.map((u) => new URL(u).origin))].slice(1)) {
    await wp.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await waitPastChallenge(wp);
  }
  let storageState = await warm.storageState();
  await warm.close();
  // Cloudflare binds `cf_clearance` to the context that solved the challenge. Replaying
  // it into a NEW context makes CF re-challenge and never clear ("Just a moment…" for the
  // whole take), whereas a context with NO clearance cookie solves it in ~10s. Keep the
  // consent cookies, drop CF's. Verified on neoseeker 2026-07-09:
  //   fresh (no storageState) -> real page | storageState as-is -> "Just a moment…" forever
  storageState = {
    ...storageState,
    cookies: storageState.cookies.filter((c) => !/^(cf_clearance|__cf_bm|__cflb|__cfruid)$/.test(c.name)),
  };

  const ctx = await browser.newContext({
    recordVideo: { dir, size: { width: 1280, height: 800 } },
    colorScheme: 'dark',
    viewport: { width: 1280, height: 800 },
    // BYPASS_CSP=1: sites whose style-src forbids inline <style> (pypi.org) attach the
    // node but never apply it — `styled` reads true while every frame paints white.
    ...(process.env.BYPASS_CSP ? { bypassCSP: true } : {}),
    // NO_STORAGE_STATE=1: some WAFs re-challenge a context that arrives carrying a
    // foreign cookie jar. Then hide the CMP via HIDE_SELECTORS instead of seeding consent.
    ...(process.env.NO_STORAGE_STATE ? {} : { storageState }),
  });
  // Match ONLY the hosts we abort. A blanket '**/*' + r.continue() re-issues every
  // request through the interception path, which breaks Cloudflare's clearance
  // handshake — neoseeker then serves the "Performing security verification" page for
  // the whole recording (and our theme paints it dark, so nothing downstream notices).
  await ctx.route((url) => BLOCK.test(url.toString()), (r) => r.abort());

  await ctx.addInitScript(({ cssText, dismissSrc }) => {
    const ID = '__walkthrough_style__';
    const ensure = () => {
      try {
        const root = document.head || document.documentElement; // may be null at document_start
        if (root) {
          let cur = document.getElementById(ID);
          if (!cur || !cur.isConnected) {
            cur = document.createElement('style');
            cur.id = ID;
            cur.textContent = cssText;
            root.appendChild(cur);
          } else if (cur.parentNode !== root || cur.nextElementSibling) {
            // KEEP OUR SHEET LAST — see defect 4. addInitScript runs at document_start, so
            // our <style> lands BEFORE every stylesheet the site later adds. Where our rule
            // and the site's have EQUAL specificity and both use !important, the tie breaks
            // on SOURCE ORDER and the site wins. Moving an existing node does not re-parse it.
            root.appendChild(cur);
          }
        }
      } catch (e) {}
      requestAnimationFrame(ensure); // reschedule in ALL paths — see defect 3
    };
    requestAnimationFrame(ensure);
    ensure();

    // Timed interstitials (donation lightbox, onboarding tour) appear long after the
    // consent cookie is seeded, so they must be dismissed DURING the take. Keep this
    // off the rAF pump: it walks the DOM, and the style pump must stay cheap.
    if (dismissSrc) {
      const re = new RegExp(dismissSrc, 'i');
      setInterval(() => {
        try {
          if (!document.body || !re.test(document.body.innerText)) return;
          const btn = [...document.querySelectorAll('button')].find((b) => {
            const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
            return /close|dismiss|no thanks|not now/i.test(label) && b.getBoundingClientRect().width > 0;
          });
          if (btn) btn.click();
        } catch (e) {}
      }, 400);
    }
  }, { cssText: css, dismissSrc: process.env.DISMISS_TEXT || '' });

  const page = await ctx.newPage();
  const log = [];
  let challenged = false;
  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      log.push(`goto-fail ${u}`);
      continue;
    }
    await page.waitForTimeout(2000);
    if (!(await waitPastChallenge(page, 30000))) {
      challenged = true;
      log.push(`CHALLENGED ${u}`);
      console.error(`FAIL: bot challenge never cleared on ${u}`);
      continue;
    }
    if (await isHardBlocked(page)) {
      // Abort the take: retrying here would film the block page AND about:blank.
      challenged = true;
      log.push(`BLOCKED ${u}`);
      console.error(`FAIL: WAF block page on ${u} — discarding take; wait out the IP block`);
      break;
    }
    const state = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      styled: !!document.getElementById('__walkthrough_style__'),
      title: document.title,
    }));
    log.push(`${u} bg=${state.bg} styled=${state.styled} title=${JSON.stringify(state.title)}`);
    if (!state.styled) console.error(`WARN: theme not attached on ${u}`);
    for (let i = 0; i < SCROLL_STEPS; i++) {
      await page.mouse.wheel(0, 150);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(500);
  }

  const vpath = await page.video().path(); // defect 2: never pick by size/duration
  await ctx.close(); // flushes the webm
  await browser.close();

  const webms = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'));
  if (webms.length !== 1) {
    console.error(`FAIL: expected 1 webm, found ${webms.length}: ${webms.join(', ')}`);
    console.error('Another page landed in this context — do NOT ship. Investigate.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outMp4), { recursive: true });
  ffmpeg(['-y', '-loglevel', 'error', '-i', vpath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-crf', '23', '-movflags', '+faststart', '-an', outMp4]);
  fs.rmSync(dir, { recursive: true, force: true });

  // Every-frame luminance sweep (stricter than the 0.25s minimum).
  const stats = path.join(os.tmpdir(), `yavg-${process.pid}.txt`);
  ffmpeg(['-v', 'error', '-i', outMp4, '-vf',
          `scale=64:40,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${stats}`,
          '-f', 'null', '-']);
  const vals = fs.readFileSync(stats, 'utf8').split('\n')
    .filter((l) => l.includes('YAVG')).map((l) => parseFloat(l.split('=')[1]));
  fs.rmSync(stats, { force: true });
  const bright = vals.filter((v) => v > BRIGHT_LIMIT).length;
  const max = Math.max(...vals);

  console.log(JSON.stringify({ out: outMp4, frames: vals.length, brightFrames: bright,
                               maxYAVG: +max.toFixed(1), challenged, log }, null, 1));
  if (challenged) {
    console.error('FAIL: a bot-challenge interstitial was filmed. NOTE: the brightness sweep');
    console.error('cannot catch this — our own theme paints the challenge page dark.');
    process.exit(1);
  }
  if (bright) {
    console.error(`FAIL: ${bright} frame(s) exceed grey mean ${BRIGHT_LIMIT} — unstyled paint or wrong site.`);
    process.exit(1);
  }
  console.error('OK: single webm, no bright frames. Still extract a few frames and LOOK.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
