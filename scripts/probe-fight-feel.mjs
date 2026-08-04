/**
 * Ad-hoc measurement harness for the fight-feel work: runs one fast match and
 * dumps every `window.__pf.contacts` record as a table, so spacing/knockback
 * numbers can be tuned against real data instead of guesses.
 *
 *   node scripts/probe-fight-feel.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5321/?fast=1';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(url);
await page.locator('.stage-card').first().click();
await page.waitForFunction(() => window.__pf.matchEnded === true, null, { timeout: 90000 });
await page.waitForTimeout(1800);

const contacts = await page.evaluate(() => window.__pf.contacts);
const audio = await page.evaluate(() => window.__pf.audio);

console.log('contacts:', contacts.length);
for (const c of contacts) {
  console.log(
    [
      c.kind.padEnd(7),
      `dmg=${String(c.damage).padStart(2)}`,
      `crit=${c.crit ? 'Y' : 'n'}`,
      c.atRest ? 'rest' : '    ',
      `gapAt=${c.gapAtEvent.toFixed(2)}`,
      `minGap=${c.minGap.toFixed(2)}`,
      `hand-chest=${c.minHandChest.toFixed(2)}`,
      `knock150=${(c.knockAt150 ?? 0).toFixed(3)}`,
      `peak=${c.peakKnockback.toFixed(2)}`,
      `settled=${c.settledMs === null ? 'NEVER' : Math.round(c.settledMs) + 'ms'}`,
      `cam=${c.cameraPeak.toFixed(3)}`,
      `at150=${c.at150Since === null ? '-' : Math.round(c.at150Since)}`
    ].join('  ')
  );
}
console.log('audio:', JSON.stringify(audio));

await browser.close();
