import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fight-feel regression suite.
 *
 * Everything here was, at some point, visibly broken while every other spec in
 * this repo stayed green: the fighters stood 5.1 units apart and punched empty
 * air, nothing ever moved on a hit, the K.O. animation was overwritten ~700ms
 * later by a recovery timer, and no run ever lasted long enough to show the
 * win/lose tableau at all.
 *
 * The numbers come from `window.__pf.contacts` — one record per landed blow,
 * which the renderer fills in over the following ~1.6s of frames. Reading a
 * finished record beats polling from Playwright: the interesting window is
 * ~150ms wide and a round trip through CDP is not reliably faster than that.
 *
 * `?fast=1` compresses turn pacing; `?hold=1` restores the dramatic pauses (the
 * punch's own follow-through, the beat after a K.O., the round transition) so a
 * fast run can still be caught mid-strike and mid-knockdown. Neither touches
 * damage, round count or the resolver.
 */

const SHOTS = process.env.PF_SHOT_DIR ?? join('test-results', 'fight-feel');

/** Compressed pacing, but every strike and knockdown played out at full length. */
const FIGHT = '/?fast=1&hold=1';

interface Contact {
  kind: string;
  by: string;
  target: string;
  damage: number;
  crit: boolean;
  t: number;
  atRest: boolean;
  gapAtEvent: number;
  minGap: number;
  minHandChest: number;
  knockAt150: number | null;
  peakKnockback: number;
  settledMs: number | null;
  cameraPeak: number;
}

async function startMatch(page: Page, query: string): Promise<void> {
  await page.goto(query);
  const stageCards = page.locator('.stage-card');
  await expect(stageCards.first()).toBeVisible();
  await stageCards.first().click();
  await page.waitForFunction(() => (window as any).__pf.selection !== null);
}

/** Presses GUARD (key 4) for a while, so the run also exercises blocked hits. */
async function guardForAWhile(page: Page, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.keyboard.press('4');
    await page.waitForTimeout(120);
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

test.describe('fight feel', () => {
  test('fighters close distance, connect, knock back and shake the camera', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT);
    // A few guarded turns early on, so `blocked` is exercised too. This is
    // player input, not a rules change.
    await guardForAWhile(page, 3000);

    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000
    });
    // Let the final impact's measurement window close before reading it back.
    await page.waitForTimeout(1800);

    const contacts: Contact[] = await page.evaluate(() => (window as any).__pf.contacts);
    expect(contacts.length, 'blows landed').toBeGreaterThan(10);

    const atRest = contacts.filter((c) => c.atRest);
    expect(atRest.length, 'blows landed from a neutral start').toBeGreaterThan(0);

    // --- G1: the fighters are in range, and the strike reaches ---------------
    const neutralGap = await page.evaluate(() => {
      const rigs = (window as any).__pf.rigs;
      return Math.abs(rigs.p1.neutralX - rigs.p2.neutralX);
    });
    expect(neutralGap, 'neutral spacing (was 5.1)').toBeLessThanOrEqual(2.6);

    for (const c of contacts) {
      expect(c.minGap, `closest gap during a ${c.kind}`).toBeLessThanOrEqual(2.6);
    }
    // Absolute spacing is only meaningful when neither fighter is still sliding
    // from the previous blow — a super throws its victim across the ring, and
    // under compressed pacing the next punch lands before they are back.
    for (const c of atRest) {
      expect(c.gapAtEvent, `gap at a ${c.kind} from neutral`).toBeLessThanOrEqual(2.6);
    }

    const reach = contacts.map((c) => c.minHandChest);
    const connected = reach.filter((d) => d <= 1.2);
    expect(Math.min(...reach), 'the best punch reaches the chest').toBeLessThanOrEqual(0.8);
    expect(median(reach), 'the typical punch reaches the chest').toBeLessThanOrEqual(1.2);
    expect(
      connected.length / contacts.length,
      `fraction of blows whose fist reached the chest (${connected.length}/${contacts.length})`
    ).toBeGreaterThanOrEqual(0.6);

    // --- G2: a landed hit shoves the defender, and it recovers ---------------
    for (const c of contacts) {
      expect(c.knockAt150, `${c.kind} knockback 150ms in (dmg ${c.damage})`).toBeGreaterThanOrEqual(
        0.2
      );
      expect(c.peakKnockback, `${c.kind} peak knockback`).toBeGreaterThanOrEqual(0.2);
    }
    // Recovery is only observable when nothing else hits the same fighter first.
    const undisturbed = contacts.filter(
      (c) => !contacts.some((o) => o !== c && o.target === c.target && o.t > c.t && o.t < c.t + 1500)
    );
    expect(undisturbed.length, 'blows with a clear 1.5s afterwards').toBeGreaterThan(0);
    for (const c of undisturbed) {
      expect(c.settledMs, `${c.kind} returned to neutral`).not.toBeNull();
      expect(c.settledMs, `${c.kind} recovery time`).toBeLessThanOrEqual(1500);
    }

    // Damage scales the shove: the heaviest blow out-shoves the lightest.
    const byDamage = [...contacts].sort((a, b) => a.damage - b.damage);
    expect(
      byDamage[byDamage.length - 1]!.peakKnockback,
      'a heavy blow out-shoves a light one'
    ).toBeGreaterThan(byDamage[0]!.peakKnockback);

    // --- G6: the camera visibly moves on every impact ------------------------
    for (const c of contacts) {
      expect(c.cameraPeak, `camera deviation on a ${c.kind}`).toBeGreaterThan(0.15);
    }

    // --- G8: every audio cue fired ------------------------------------------
    const audio = await page.evaluate(() => (window as any).__pf.audio);
    for (const cue of ['whoosh', 'hit', 'block', 'crit', 'ko', 'bell', 'win']) {
      expect(audio[cue], `${cue} cue fired`).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });

  test('the K.O. loser stays on the ground instead of standing back up', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT);

    await page.waitForFunction(() => (window as any).__pf.koAt !== null, null, { timeout: 60000 });
    const loser = await page.evaluate(() => {
      const ko = (window as any).__pf.events.filter((e: any) => e.type === 'ko').pop();
      return ko.loser as 'p1' | 'p2';
    });

    // The bug this pins: a 700ms recovery timer reset BOTH fighters to `idle`,
    // guarded only by `matchOver` — so a round-ending K.O. had its death
    // animation wiped before anyone could see it.
    await page.waitForTimeout(1500);

    const rigs = await page.evaluate(() => (window as any).__pf.rigs);
    expect(rigs[loser].pose, '1.5s after the K.O. the loser is still down').toBe('ko');
    expect(rigs[loser === 'p1' ? 'p2' : 'p1'].pose, 'the winner is celebrating').toBe('win');

    const standing = rigs[loser].standingRootY;
    expect(standing, 'a standing hip height was recorded').toBeGreaterThan(0);
    expect(
      rigs[loser].root[1],
      `hips dropped from ${standing.toFixed(2)} to ${rigs[loser].root[1].toFixed(2)}`
    ).toBeLessThanOrEqual(standing * 0.7);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'ko-hold.png') });

    expect(errors).toEqual([]);
  });

  test('the match ends with one fighter celebrating and one on the floor', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT);
    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000
    });

    const winner = await page.evaluate(() => {
      const end = (window as any).__pf.events.filter((e: any) => e.type === 'matchEnd').pop();
      return end.winner as 'p1' | 'p2';
    });
    const loser = winner === 'p1' ? 'p2' : 'p1';

    await page.waitForTimeout(1500);

    const rigs = await page.evaluate(() => (window as any).__pf.rigs);
    expect(rigs[winner].pose, 'winner celebrates').toBe('win');
    expect(rigs[loser].pose, 'loser stays defeated').toBe('ko');

    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 10000 });

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'match-end.png') });

    expect(errors).toEqual([]);
  });

  test('a combo counter pops and escalates instead of sitting there as static text', async ({
    page
  }) => {
    await page.goto('/?fast=1');

    // Drive the HUD element directly: combo escalation is a presentation rule,
    // and which transcript happens to produce an 8-hit run is not this spec's
    // problem.
    const styles = await page.evaluate(() => {
      const node = document.getElementById('p1-combo')!;
      const read = (count: number) => {
        node.textContent = `${count} HIT COMBO`;
        node.className = 'combo left';
        const tier = count >= 6 ? 'tier-3' : count >= 4 ? 'tier-2' : 'tier-1';
        void node.offsetWidth;
        node.classList.add('pop', tier);
        const computed = getComputedStyle(node);
        return {
          animationName: computed.animationName,
          fontSize: parseFloat(computed.fontSize),
          opacity: parseFloat(computed.opacity)
        };
      };
      return { two: read(2), five: read(5), eight: read(8) };
    });

    // Not static: an animation is actually attached, and it starts visible.
    expect(styles.two.animationName).not.toBe('none');
    expect(styles.two.opacity).toBeGreaterThan(0);
    // Escalation: each tier is a distinct, larger treatment.
    expect(
      new Set([styles.two.animationName, styles.five.animationName, styles.eight.animationName]).size
    ).toBe(3);
    expect(styles.five.fontSize).toBeGreaterThan(styles.two.fontSize);
    expect(styles.eight.fontSize).toBeGreaterThan(styles.five.fontSize);
  });
});
