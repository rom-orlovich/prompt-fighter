/**
 * Captures the moments the fight-feel work is about, as real rendered frames.
 *
 * The Playwright specs assert numbers; this exists so a human (or an agent with
 * eyes) can confirm the numbers correspond to something that actually looks
 * like a fight. Needs a real GPU — run it headed against :0:
 *
 *   DISPLAY=:0 node scripts/capture-fight-feel.mjs [url] [outDir]
 *
 * `?draw=1` keeps the WebGL loop running under `?fast=1`, and `?hold=1` keeps
 * the strikes and the K.O./result beats at full length, so the whole match is
 * watchable in well under a minute instead of ninety seconds.
 *
 * One caveat, stated plainly: neither bundled transcript ever produces a 2+ hit
 * combo (the speakers alternate, so nobody lands twice in a row), so the combo
 * frame is captured by driving the real HUD element with a real count. The
 * component and the CSS are the shipped ones; only the trigger is synthetic.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5321/?fast=1&hold=1&draw=1';
const outDir = process.argv[3] ?? '/tmp/fight-feel-shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false, args: ['--window-size=1280,760'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

const shot = async (name) => {
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log('captured', path);
};

await page.goto(url);
await page.waitForTimeout(2500); // let the glTF bodies load before anything is captured
await page.locator('.stage-card').first().click();

// One polling loop rather than a chain of waits: the interesting moments are
// milliseconds wide, and waiting for one in sequence means missing the next.
let gotCrit = false;
let koShot = null;
let endShot = null;
const deadline = Date.now() + 180000;

while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({
    crit: window.__pf.contacts.some((c) => c.crit),
    koAt: window.__pf.koAt,
    endedAt: window.__pf.matchEndedAt,
    now: performance.now()
  }));

  if (!gotCrit && state.crit) {
    gotCrit = true;
    await shot('crit-impact');
  }

  if (!koShot && state.koAt !== null && state.now - state.koAt >= 1500) {
    koShot = true;
    await shot('ko-plus-1500ms');
    console.log(
      'poses at ko+1.5s:',
      JSON.stringify(
        await page.evaluate(() => ({
          p1: window.__pf.rigs.p1.pose,
          p2: window.__pf.rigs.p2.pose,
          p1RootY: Number(window.__pf.rigs.p1.root[1].toFixed(3)),
          p2RootY: Number(window.__pf.rigs.p2.root[1].toFixed(3)),
          p1Standing: Number(window.__pf.rigs.p1.standingRootY.toFixed(3)),
          p2Standing: Number(window.__pf.rigs.p2.standingRootY.toFixed(3))
        }))
      )
    );
  }

  if (!endShot && state.endedAt !== null && state.now - state.endedAt >= 1500) {
    endShot = true;
    await shot('match-end-plus-1500ms');
    console.log(
      'poses at matchEnd+1.5s:',
      JSON.stringify(
        await page.evaluate(() => ({
          p1: window.__pf.rigs.p1.pose,
          p2: window.__pf.rigs.p2.pose
        }))
      )
    );
    break;
  }

  await page.waitForTimeout(80);
}

// The result card, once it has slid in over the held tableau.
await page.waitForTimeout(2500);
await shot('result-card');

// The combo counter, driven directly (see the note at the top of this file).
await page.evaluate(() => {
  document.getElementById('result').classList.add('hidden');
  const node = document.getElementById('p1-combo');
  node.textContent = '7 HIT COMBO!!';
  node.className = 'combo left';
  void node.offsetWidth;
  node.classList.add('pop', 'tier-3');
});
await page.waitForTimeout(180);
await shot('combo-tier-3');

await browser.close();
