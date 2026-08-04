/**
 * Samples the striking fist against the opponent's chest, component by
 * component, over a whole fast match — used to tune neutral spacing and the
 * step-in distance so a punch actually arrives.
 *
 *   node scripts/probe-reach.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5321/?fast=1';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(url);
await page.evaluate(() => {
  window.__samples = [];
  setInterval(() => {
    const rigs = window.__pf.rigs;
    if (!rigs) return;
    for (const [by, target] of [
      ['p1', 'p2'],
      ['p2', 'p1']
    ]) {
      if (rigs[by].pose !== 'attack') continue;
      const h = rigs[by].hand;
      const c = rigs[target].chest;
      window.__samples.push({
        by,
        d: Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]),
        dx: h[0] - c[0],
        dy: h[1] - c[1],
        dz: h[2] - c[2],
        gap: Math.abs(rigs.p1.position[0] - rigs.p2.position[0]),
        handX: h[0],
        bodyX: rigs[by].position[0]
      });
    }
  }, 8);
});
await page.locator('.stage-card').first().click();
await page.waitForFunction(() => window.__pf.matchEnded === true, null, { timeout: 90000 });

const samples = await page.evaluate(() => window.__samples);
samples.sort((a, b) => a.d - b.d);
console.log('samples during an attack pose:', samples.length);
for (const s of samples.slice(0, 8)) {
  console.log(
    `${s.by} d=${s.d.toFixed(2)} dx=${s.dx.toFixed(2)} dy=${s.dy.toFixed(2)} dz=${s.dz.toFixed(
      2
    )} gap=${s.gap.toFixed(2)} fistReach=${Math.abs(s.handX - s.bodyX).toFixed(2)}`
  );
}
console.log('median d:', samples[Math.floor(samples.length / 2)]?.d.toFixed(2));

await browser.close();
