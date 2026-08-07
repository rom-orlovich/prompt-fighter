import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUPER_NAMES } from '../src/engine/combat';

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
  streak: number;
}

/** `cardIndex` picks which bundled transcript to run — see `STAGES` in `main.ts`. */
async function startMatch(page: Page, query: string, cardIndex = 0): Promise<void> {
  await page.goto(query);
  const stageCards = page.locator('.stage-card');
  await expect(stageCards.nth(cardIndex)).toBeVisible();
  await stageCards.nth(cardIndex).click();
  await page.waitForFunction(() => (window as any).__pf.selection !== null, null, { polling: 100 });
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

/** Every super's display name, e.g. "CONFIDENT FABRICATION" — a super-kind
 * ability's `AbilityDef.name` always equals its owner's `SUPER_NAMES` entry
 * (see `tests/abilities.test.ts`), so this is how G20b tells a super-kind
 * `ability` event apart from a passive one without importing `abilities.ts`
 * into a Playwright spec. */
const SUPER_ABILITY_NAMES = new Set(Object.values(SUPER_NAMES));

/**
 * G20b: splits a real match's `ability` events into meter-full supers and
 * combo-triggered specials. A super-kind ability event belongs to a
 * meter-full super turn if a `super` CombatEvent already fired since the last
 * `attack` — exactly the window `case 'ability'` in `main.ts` shares with
 * `case 'super'` for the same physical strike (see `turnSuperFired`) — so
 * anything left over fired WITHOUT the meter being full: the combo-earned
 * path (`COMBO_SPECIAL_CHAIN_THRESHOLD` in `src/engine/abilities.ts`).
 */
function splitSpecials(events: { type: string; name?: string }[]): {
  meterFullSupers: number;
  comboSpecials: number;
} {
  let meterFullSupers = 0;
  let comboSpecials = 0;
  let turnHasSuper = false;
  for (const e of events) {
    if (e.type === 'attack') turnHasSuper = false;
    if (e.type === 'super') {
      meterFullSupers += 1;
      turnHasSuper = true;
    }
    if (e.type === 'ability' && e.name && SUPER_ABILITY_NAMES.has(e.name) && !turnHasSuper) {
      comboSpecials += 1;
    }
  }
  return { meterFullSupers, comboSpecials };
}

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
      timeout: 120000,
      polling: 100
    });
    // Let the final impact's measurement window close before reading it back.
    await page.waitForTimeout(1800);

    const contacts: Contact[] = await page.evaluate(() => (window as any).__pf.contacts);
    expect(contacts.length, 'blows landed').toBeGreaterThan(10);

    // --- G17: the expanded move vocabulary actually gets used -----------------
    // A clip that's vendored but never triggered in a real match is not a
    // move, it's dead weight — this is the MEASURED half of that check (the
    // LOOKED-AT half is the screenshot specs below and the G17 done-marker).
    const playedClips: string[] = await page.evaluate(() => (window as any).__pf.playedClips());
    console.log('distinct clips played in a real match:', playedClips.sort().join(', '));
    // G20a adds one more clip (`Jump_Start`) to the vocabulary this floor
    // already measures — raised from 6 to 7 so it's part of what this
    // assertion actually requires, not just headroom it happens to clear.
    expect(playedClips.length, `distinct clips played (${playedClips.join(', ')})`).toBeGreaterThanOrEqual(7);

    // --- G20a: a jump actually goes live in a real, undriven match -----------
    // `playedClips` above already proves the mixer really played `Jump_Start`
    // (not just that it was vendored); `posesSeen` proves a real rendered
    // frame (simulated timer under `?fast=1`, see `stage.startSimulation`)
    // actually read `jump` back as the CURRENT pose at least once — the
    // same-synchronous-batch trap this file's own comments warn about would
    // leave a pose requested but never observed here.
    expect(playedClips, 'Jump_Start actually played').toContain('Jump_Start');
    const p1Poses: string[] = await page.evaluate(() => (window as any).__pf.posesSeen('p1'));
    const p2Poses: string[] = await page.evaluate(() => (window as any).__pf.posesSeen('p2'));
    console.log('poses observed live: p1', p1Poses.sort().join(', '), '| p2', p2Poses.sort().join(', '));
    expect(p1Poses.includes('jump') || p2Poses.includes('jump'), 'jump pose observed live on either side').toBe(
      true
    );
    const grappleAttacks = (await page.evaluate(() => (window as any).__pf.events)).filter(
      (e: any) => e.type === 'attack' && e.kind === 'GRAPPLE'
    ).length;
    console.log('GRAPPLE attacks fired (jump-eligible turns) this match:', grappleAttacks);
    expect(grappleAttacks, 'at least one GRAPPLE turn to have earned a jump').toBeGreaterThan(0);

    // --- G20b: a combo-triggered special fires without the meter being full,
    // and a meter-full super still fires exactly as it did before this loop.
    const specials = splitSpecials(await page.evaluate(() => (window as any).__pf.events));
    console.log('meter-full supers:', specials.meterFullSupers, '| combo-triggered specials:', specials.comboSpecials);
    expect(specials.meterFullSupers, 'meter-full supers still fire').toBeGreaterThan(0);
    expect(specials.comboSpecials, 'a combo-triggered special fires without the meter being full').toBeGreaterThan(
      0
    );

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

  // --- G13: the streaming-text billboard must not cover the fighters -------
  //
  // The in-world CRT billboard used to float above each fighter's head bone,
  // repositioned there every frame. It sat ON the heads once the arena
  // spacing was tightened (see G1 above), the two fighters' panels overlapped
  // each other mid-exchange, and the same streaming text was already fully
  // legible in the HUD subtitle bar (`hud.subtitle`, driven by the same
  // `onTurnChunk` callback) — so it was removed outright (route B) rather
  // than relocated: `src/render/fighter.ts` no longer creates a sprite at
  // all. `window.__pf.spriteCount()` counts every `THREE.Sprite` live in the
  // arena scene graph; this samples it at several moments across a real,
  // undriven match and asserts it never leaves zero, so a billboard sprite
  // (on a head or anywhere else) reappearing fails this spec instead of
  // shipping unnoticed.
  test('no billboard sprite exists in the arena scene at any point in a real match', async ({
    page
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT);

    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      samples.push(await page.evaluate(() => (window as any).__pf.spriteCount()));
      if (await page.evaluate(() => (window as any).__pf.matchEnded)) break;
      await page.waitForTimeout(400);
    }

    expect(samples.length, 'sampled at several distinct moments').toBeGreaterThan(3);
    for (const count of samples) {
      expect(count, 'THREE.Sprite objects in the arena scene').toBe(0);
    }

    expect(errors).toEqual([]);
  });

  test('the K.O. loser stays on the ground instead of standing back up', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT);

    await page.waitForFunction(() => (window as any).__pf.koAt !== null, null, {
      timeout: 60000,
      polling: 100
    });
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
      timeout: 120000,
      polling: 100
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

  // --- G9: the victory must read as a victory -------------------------------
  test('the winner celebrates — measured hand travel and a screenshot check', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Needs real rendering for the screenshots below to mean anything; `draw=1`
    // is the "watchable match" flag, not the sampling itself (that reads
    // `window.__pf.rigs`, which is live under plain `?fast=1` too). Same caveat
    // as `demo-recording.test.ts`: under a software rasteriser the real render
    // loop runs at ~2fps, `scene.ts` clamps each frame's delta to 0.05s, and the
    // arcade clock crawls — the match would never reach `matchEnd` inside any
    // sane timeout, so this self-skips rather than proving nothing slowly.
    await page.goto('/');
    const renderer = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return 'none';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    test.skip(
      /swiftshader|llvmpipe|software|none/i.test(renderer),
      `software rasteriser (${renderer}) cannot sustain the render loop — run with --headed on a real GPU`
    );

    await startMatch(page, '/?fast=1&hold=1&draw=1');

    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000,
      polling: 100
    });

    const winner = await page.evaluate(() => {
      const end = (window as any).__pf.events.filter((e: any) => e.type === 'matchEnd').pop();
      return end.winner as 'p1' | 'p2';
    });
    const loser = winner === 'p1' ? 'p2' : 'p1';

    // MEASURED: sample the winner's hand every ~150ms for 3s after matchEnd.
    const samples: number[][] = await page.evaluate(async (side) => {
      const out: number[][] = [];
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        const rigs = (window as any).__pf.rigs;
        out.push(rigs[side].hand as number[]);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return out;
    }, winner);

    expect(samples.length, 'enough samples over the 3s window').toBeGreaterThan(10);
    const axisRange = (axis: number) =>
      Math.max(...samples.map((s) => s[axis]!)) - Math.min(...samples.map((s) => s[axis]!));
    const ranges = [axisRange(0), axisRange(1), axisRange(2)];
    console.log('winner hand-position ranges x/y/z:', ranges.map((n) => n.toFixed(3)));
    expect(
      Math.max(...ranges),
      `winner hand-position range x/y/z = ${ranges.map((n) => n.toFixed(2)).join('/')} (was 0.46/0.58 before the fix)`
    ).toBeGreaterThan(1.2);

    // (c) the loser must still be down — this reads well past matchEnd+1.5s
    // since the 3s sampling loop above already ran.
    const rigs = await page.evaluate(() => (window as any).__pf.rigs);
    expect(rigs[loser].pose, 'loser stays down through the winner\'s celebration').toBe('ko');
    expect(
      rigs[loser].root[1],
      `loser hips (${rigs[loser].root[1].toFixed(2)}) stay under 30% of standing height (${rigs[
        loser
      ].standingRootY.toFixed(2)})`
    ).toBeLessThanOrEqual(rigs[loser].standingRootY * 0.3);

    // LOOKED AT: screenshot the winner at several moments, result card hidden,
    // for a human/agent to actually look at (see rollout step 1).
    await page.evaluate(() => {
      const result = document.getElementById('result');
      if (result) result.style.display = 'none';
    });
    mkdirSync(SHOTS, { recursive: true });
    for (let i = 0; i < 4; i++) {
      await page.screenshot({ path: join(SHOTS, `victory-${i}.png`) });
      await page.waitForTimeout(350);
    }

    expect(errors).toEqual([]);
  });

  // --- G11: combo feedback must fire in BOTH bundled stages, not just one ---
  //
  // G10 wired the HUD counter to "2+ `hit` events landed in a single turn",
  // which only happens when a super also carries a `drain` effect — only
  // GEMINI's kit does that, so this fired for tabs-vs-spaces (GEMINI vs
  // LOCAL 7B) and silently never fired for microservices (CLAUDE vs CODEX).
  // That is exactly how a half-broken counter shipped green: the one test
  // below only ever checked the stage that happened to work. G11 re-bases
  // the counter on a real streak (see `extendStreak` in `main.ts`), so this
  // now runs both bundled stages and fails if either stops producing combos.
  for (const [stageName, cardIndex] of [
    ['microservices (CLAUDE vs CODEX)', 0],
    ['tabs-vs-spaces (GEMINI vs LOCAL 7B)', 1]
  ] as const) {
    test(`the combo counter fires during a real, undriven ${stageName} match`, async ({ page }) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await startMatch(page, FIGHT, cardIndex);
      await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
        timeout: 120000,
        polling: 100
      });

      const combos: { side: string; count: number }[] = await page.evaluate(
        () => (window as any).__pf.presentationCombos
      );
      console.log(`presentation combos observed in ${stageName}:`, JSON.stringify(combos));

      expect(
        combos.length,
        `the HUD combo counter fired at least once in an undriven ${stageName} match`
      ).toBeGreaterThan(0);
      for (const combo of combos) {
        expect(combo.count, `displayed combo count for ${combo.side}`).toBeGreaterThanOrEqual(2);
      }

      expect(errors).toEqual([]);
    });
  }

  // --- G14: a running combo must be felt, not just counted -----------------
  //
  // `streakCount` (see `extendStreak` in `main.ts`) already drove the HUD
  // combo counter before this loop — nothing in the impact path read it back,
  // so a 4th consecutive blow shook the camera, hit-stopped and flashed
  // exactly like the 1st. `comboScale` now scales shake/hitstop/zoom/flash/
  // particles by the streak a landed blow belongs to (`ContactRecord.streak`,
  // read straight off the same counter the HUD uses), clamped at streak 5 so
  // a long combo stays dramatic instead of turning a 20s clip into a
  // slideshow. Runs the microservices stage (cardIndex 0) — the bundled
  // transcript the G11 comment above notes reaches a 5-streak, unlike
  // tabs-vs-spaces' 3.
  test('impact escalates with a running combo, measured and looked at', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Needs real rendering — the screenshots below have to mean something.
    // Same self-skip as the victory-celebration spec: under a software
    // rasteriser the render loop can't sustain a full match in any sane
    // timeout, so this proves nothing slowly instead of failing loudly.
    await page.goto('/');
    const renderer = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return 'none';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    test.skip(
      /swiftshader|llvmpipe|software|none/i.test(renderer),
      `software rasteriser (${renderer}) cannot sustain the render loop — run with --headed on a real GPU`
    );

    await startMatch(page, '/?fast=1&hold=1&draw=1', 0);

    // LOOKED AT: grab a streak-1 blow and a streak-4-or-higher blow the
    // moment each lands, while the shake/flash/burst are still on screen —
    // waiting until after `matchEnded` would only ever catch the stage at
    // rest.
    mkdirSync(SHOTS, { recursive: true });
    let seen = 0;
    let shotLow: string | null = null;
    let shotHigh: string | null = null;
    const shotDeadline = Date.now() + 120000;
    while ((!shotLow || !shotHigh) && Date.now() < shotDeadline) {
      const contacts: Contact[] = await page.evaluate(() => (window as any).__pf.contacts);
      if (contacts.length > seen) {
        const fresh = contacts.slice(seen);
        seen = contacts.length;
        for (const c of fresh) {
          if (!shotLow && c.streak === 1) {
            await page.waitForTimeout(60); // let this frame's shake/flash paint
            shotLow = join(SHOTS, 'combo-streak-1.png');
            await page.screenshot({ path: shotLow });
          }
          if (!shotHigh && c.streak >= 4) {
            await page.waitForTimeout(60);
            shotHigh = join(SHOTS, 'combo-streak-4plus.png');
            await page.screenshot({ path: shotHigh });
          }
        }
      }
      if (await page.evaluate(() => (window as any).__pf.matchEnded)) break;
      await page.waitForTimeout(40);
    }
    expect(shotLow, 'captured a streak-1 blow screenshot').not.toBeNull();
    expect(shotHigh, 'captured a streak-4-or-higher blow screenshot').not.toBeNull();

    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000,
      polling: 100
    });
    // Let the final impact's measurement window close before reading it back.
    await page.waitForTimeout(1800);

    // MEASURED: per-streak average camera peak, straight from the same
    // `window.__pf.contacts` records G6 already reads `cameraPeak` off of.
    //
    // A `super`'s camera shake mostly comes from its own named-special FX
    // (`fx.special`'s `spec.shake`, independent of `comboScale` — see the
    // 'super' case in `main.ts`), so it's excluded here: it would otherwise
    // inject a second, unrelated source of variance into a comparison that's
    // supposed to isolate the streak's effect. `hit`/`counter` blows are the
    // ones `comboScale` fully controls.
    //
    // Crit and non-crit blows have very different baselines (0.85 vs 0.5
    // base shake) — pooling both crit-ness classes into one streak-1 average
    // makes that composition, not the streak, the thing driving the number.
    // Comparing each streak>=3 blow against the streak-1 average of blows
    // with the SAME crit-ness isolates what `comboScale` alone contributed.
    const contacts: Contact[] = await page.evaluate(() => (window as any).__pf.contacts);
    const scored = contacts.filter((c) => c.kind !== 'super');
    const avg = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

    const byStreak = new Map<number, number[]>();
    for (const c of scored) {
      const bucket = byStreak.get(c.streak) ?? [];
      bucket.push(c.cameraPeak);
      byStreak.set(c.streak, bucket);
    }
    const summary = [...byStreak.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([streak, values]) => ({ streak, n: values.length, avgCameraPeak: Number(avg(values).toFixed(3)) }));
    console.log('cameraPeak by streak (microservices, undriven, hit/counter only):', JSON.stringify(summary));

    const streak1ByCrit = {
      false: scored.filter((c) => c.streak === 1 && !c.crit).map((c) => c.cameraPeak),
      true: scored.filter((c) => c.streak === 1 && c.crit).map((c) => c.cameraPeak)
    };
    const highStreak = scored.filter((c) => c.streak >= 3);
    console.log(
      'streak-1 baselines — non-crit:',
      streak1ByCrit.false.map((n) => n.toFixed(3)),
      'crit:',
      streak1ByCrit.true.map((n) => n.toFixed(3))
    );
    expect(streak1ByCrit.false.length, 'non-crit streak-1 blows observed').toBeGreaterThan(0);
    expect(highStreak.length, 'streak>=3 hit/counter blows observed in this match').toBeGreaterThan(0);

    const ratios = highStreak.map((c) => {
      const baseline = avg(c.crit ? streak1ByCrit.true : streak1ByCrit.false);
      return { streak: c.streak, crit: c.crit, cameraPeak: c.cameraPeak, baseline, ratio: c.cameraPeak / baseline };
    });
    console.log('streak>=3 vs same-crit streak-1 baseline:', JSON.stringify(ratios.map((r) => ({
      streak: r.streak,
      crit: r.crit,
      cameraPeak: Number(r.cameraPeak.toFixed(3)),
      baseline: Number(r.baseline.toFixed(3)),
      ratio: Number(r.ratio.toFixed(3))
    }))));

    // NO REGRESSION: `comboScale(1, step) === 1` exactly, so a streak-1
    // blow's shake/hitstop/zoom/flash/particles compute identically to
    // before this loop — G6 above (`cameraPeak > 0.15` for every contact)
    // already pins that floor for every blow including these.
    const avgRatio = avg(ratios.map((r) => r.ratio));
    expect(
      avgRatio,
      `streak>=3 blows should average at least 40% more camera peak than a same-crit-ness ` +
        `streak-1 blow in the same match (got average ratio ${avgRatio.toFixed(3)}: ${JSON.stringify(
          ratios.map((r) => `streak${r.streak}${r.crit ? '(crit)' : ''}=${r.ratio.toFixed(2)}x`)
        )})`
    ).toBeGreaterThanOrEqual(1.4);

    expect(errors).toEqual([]);
  });

  // --- G18: a running combo must read as a CHAIN, not repeated single hits -
  //
  // Before this loop `clipFor` in `fighter.ts` picked the attack clip from a
  // global round-robin cursor that advanced on every attack whether or not a
  // streak was running, so which punch played had no relationship to where a
  // combo actually was, and the victim's reaction was chosen by crit/counter/
  // super alone — never by chain position. `window.__pf.comboChain` (see
  // `main.ts`) now logs exactly the blows that extended a real streak, in
  // order, each with the chain position it landed at and the clip that threw
  // it — a maximal run of consecutive same-side entries IS one combo streak,
  // since a different attacker landing a damaging blow is precisely what
  // starts a new streak. Runs the microservices stage (cardIndex 0), which
  // the G14 comment above notes reaches a 5-streak.
  test('a combo chain reads as a sequence: strikes follow chain position, and breaking resets it', async ({
    page
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT, 0);
    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000,
      polling: 100
    });
    // Let the final impact's measurement window close before reading it back.
    await page.waitForTimeout(1800);

    const chain: { side: string; position: number; clip: string | null; followsSuper: boolean }[] =
      await page.evaluate(() => (window as any).__pf.comboChain);
    expect(chain.length, 'chain-extending blows recorded in a real match').toBeGreaterThan(3);

    // Split into runs on every `position === 1` — that IS a streak break,
    // whether it came from the other side landing a blow or a round ending
    // (`resetStreak` on `roundEnd`/`matchEnd`, see main.ts). Grouping by
    // `side` instead would be wrong: the same fighter can easily open the
    // very next round too, and that is a fresh run, not a continuation of
    // the previous one — this measured run split on a real match caught
    // exactly that the first time this test was written.
    const runs: (typeof chain)[] = [];
    for (const entry of chain) {
      if (entry.position === 1 || runs.length === 0) runs.push([entry]);
      else runs[runs.length - 1]!.push(entry);
    }
    console.log(
      'combo chain runs observed (microservices, undriven):',
      JSON.stringify(runs.map((run) => `streak of ${run.length} (${run[0]!.side}): ${run.map((e) => e.clip).join(', ')}`))
    );

    // (a) MEASURED: every landed blow's clip follows the intended position ->
    // clip mapping (1 jab, 2 cross, 3-and-beyond hook — see
    // `attackClipForPosition` in `fighter.ts`), checked against every entry
    // in the whole match, not just inside a long run. `followsSuper` entries
    // are excluded: a super turn always fires its own `super` event PLUS a
    // `hit` event for the same physical strike's credibility change (see
    // `turnSuperFired` in main.ts and the long comment above `streakSide`) —
    // only ONE `attack` pose was ever thrown for that pair, so the follow-up
    // `hit` is expected to repeat the super's own clip, not advance to the
    // next position's clip.
    const EXPECTED_CLIP = ['Punch_Jab', 'Punch_Cross', 'Melee_Hook'];
    const strikes = chain.filter((e) => !e.followsSuper);
    expect(strikes.length, 'blows backed by a genuinely thrown strike').toBeGreaterThan(3);
    for (const entry of strikes) {
      const expectedClip = EXPECTED_CLIP[Math.min(entry.position, EXPECTED_CLIP.length) - 1];
      expect(entry.clip, `beat ${entry.position} plays ${expectedClip} (full chain: ${JSON.stringify(chain)})`).toBe(
        expectedClip
      );
    }
    // And within a streak of >= 3 the strikes are NOT all the same clip —
    // the mapping above already implies this once a run is long enough, but
    // it is asserted directly too, as its own check.
    const longRuns = runs.filter((run) => run.filter((e) => !e.followsSuper).length >= 3);
    expect(longRuns.length, 'at least one streak of length >= 3 observed').toBeGreaterThan(0);
    for (const run of longRuns) {
      const clips = run.filter((e) => !e.followsSuper).map((e) => e.clip);
      expect(new Set(clips).size, `streak of ${run.length} strikes are not all the same clip (${clips.join(', ')})`).toBeGreaterThan(
        1
      );
    }

    // (b) MEASURED: the chain RESETS. This is the specific bug being fixed —
    // the old global cursor kept advancing across a streak break, so the
    // first blow of a new run would have picked up wherever the cursor left
    // off (Cross or Hook) instead of restarting at the jab. More than one
    // run must exist (i.e. a break actually happened during this match), and
    // every run — not just the first — opens at beat 1 on the jab, and
    // climbs 1, 2, 3, ... with no gaps.
    expect(runs.length, 'more than one streak observed, so a reset actually happened').toBeGreaterThan(1);
    for (const run of runs) {
      expect(run[0]!.position, `run opens at beat 1 (${JSON.stringify(run)})`).toBe(1);
      expect(
        run[0]!.clip,
        `run opens on the jab, not wherever the previous run's cursor left off (${JSON.stringify(run)})`
      ).toBe('Punch_Jab');
      run.forEach((entry, i) => {
        expect(entry.position, `beat ${i + 1} of streak ${JSON.stringify(run)}`).toBe(i + 1);
      });
    }

    expect(errors).toEqual([]);
  });

  // --- G20: a jump and a combo-triggered special must both be LOOKED AT ----
  //
  // The MEASURED half of both checks lives in the first "fight feel" spec
  // above (`playedClips`/`posesSeen` for the jump, `splitSpecials` for the
  // special) — this is the LOOKED-AT half: a jump that reads as a twitch, or
  // a special indistinguishable from a normal hit, is a FAIL no measurement
  // alone can catch. Needs real rendering, same self-skip as G9/G14.
  test('a jump and a combo-triggered special are both visually legible, looked at on a real GPU', async ({
    page
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    const renderer = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return 'none';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    test.skip(
      /swiftshader|llvmpipe|software|none/i.test(renderer),
      `software rasteriser (${renderer}) cannot sustain the render loop — run with --headed on a real GPU`
    );

    // cardIndex 0 (microservices): the same stage G14/G18 rely on reaching a
    // deep combo chain, and the one measurably producing GRAPPLE turns.
    await startMatch(page, '/?fast=1&hold=1&draw=1', 0);

    mkdirSync(SHOTS, { recursive: true });
    let jumpShot: string | null = null;
    let specialShot: string | null = null;
    // Tracks the RUNNING count from `splitSpecials`, not just "an ability
    // event fired" — a meter-full super also fires super-kind `ability`
    // events (see `splitSpecials`), so only a rise in `comboSpecials`
    // specifically (never `meterFullSupers`) means THIS poll caught a
    // combo-triggered special, not a meter-full one.
    let lastComboSpecials = 0;
    const deadline = Date.now() + 120000;

    while ((!jumpShot || !specialShot) && Date.now() < deadline) {
      if (!jumpShot) {
        const rigs = await page.evaluate(() => (window as any).__pf.rigs);
        if (rigs.p1.pose === 'jump' || rigs.p2.pose === 'jump') {
          await page.waitForTimeout(150); // let the crossfade settle into a clean frame
          jumpShot = join(SHOTS, 'jump.png');
          await page.screenshot({ path: jumpShot });
        }
      }
      if (!specialShot) {
        const events: any[] = await page.evaluate(() => (window as any).__pf.events);
        const { comboSpecials } = splitSpecials(events);
        if (comboSpecials > lastComboSpecials) {
          await page.waitForTimeout(80); // catch the fx.special burst/ring while it's live
          specialShot = join(SHOTS, 'combo-special.png');
          await page.screenshot({ path: specialShot });
        }
        lastComboSpecials = comboSpecials;
      }
      if (await page.evaluate(() => (window as any).__pf.matchEnded)) break;
      await page.waitForTimeout(40);
    }

    expect(jumpShot, 'captured the jump pose live').not.toBeNull();
    expect(specialShot, 'captured a combo-triggered special live').not.toBeNull();

    expect(errors).toEqual([]);
  });

  // --- G21: the "coiled power" read must actually react, not sit flat ------
  //
  // The critic's second measured problem: "energy" was a flat constant,
  // modulated only by per-turn charge/flash — nothing read the fight's own
  // meter/combo state back into the rig. `FighterRig.setAggression` (see
  // `fighter.ts`) is what now does that — it drives the silhouette rim glow,
  // the ground glow and an extra forward lean, and its eased 0-1 value is
  // read straight back here off `window.__pf.rigs[side].aggression`. This is
  // the MEASURED half of the check (the LOOKED-AT half is the screenshots
  // captured by hand against a real GPU — see the rollout's done-marker):
  // proof the number itself moves across a real, undriven match rather than
  // being requested once and never changing.
  test('a fighter reads more dangerous as its meter/combo build — measured aggression actually changes', async ({
    page
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await startMatch(page, FIGHT, 0);

    const samples: { t: number; p1: number; p2: number }[] = [];
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const rigs = await page.evaluate(() => (window as any).__pf.rigs);
      samples.push({ t: Date.now(), p1: rigs.p1.aggression, p2: rigs.p2.aggression });
      if (await page.evaluate(() => (window as any).__pf.matchEnded)) break;
      await page.waitForTimeout(120);
    }
    // A little past matchEnd too: a super or long streak just before the K.O.
    // should still be visibly decaying, not frozen at whatever it last hit.
    await page.waitForTimeout(1000);
    const rigsAfter = await page.evaluate(() => (window as any).__pf.rigs);
    samples.push({ t: Date.now(), p1: rigsAfter.p1.aggression, p2: rigsAfter.p2.aggression });

    expect(samples.length, 'enough samples across a real match').toBeGreaterThan(10);

    const p1Values = samples.map((s) => s.p1);
    const p2Values = samples.map((s) => s.p2);
    console.log(
      'aggression range — p1:',
      Math.min(...p1Values).toFixed(3),
      '-',
      Math.max(...p1Values).toFixed(3),
      '| p2:',
      Math.min(...p2Values).toFixed(3),
      '-',
      Math.max(...p2Values).toFixed(3)
    );

    // (1) It is not a flat constant on EITHER side across the match.
    for (const [side, values] of [
      ['p1', p1Values],
      ['p2', p2Values]
    ] as const) {
      const range = Math.max(...values) - Math.min(...values);
      expect(range, `${side} aggression range across the match (flat = never reacts)`).toBeGreaterThan(0.15);
    }

    // (2) It opens near neutral — meter and streak both start at 0, so the
    // very first sample (taken right after the match starts) must read low,
    // not already hot. Pins the "0 at rest" half of the eased range.
    expect(Math.min(samples[0]!.p1, samples[0]!.p2), 'opens near neutral').toBeLessThan(0.25);

    // (3) At least one side genuinely builds up — a fighter deep in a combo
    // or sitting on a full meter must read meaningfully hotter than the
    // match's opening moment.
    expect(
      Math.max(Math.max(...p1Values), Math.max(...p2Values)),
      'at least one side visibly builds toward full aggression'
    ).toBeGreaterThan(0.5);

    expect(errors).toEqual([]);
  });

  // --- G22: a fighter must never be rendered in its bind/T-pose ------------
  //
  // The critic's measured defect: at the very start of a match both fighters
  // rendered arms-out, upright — a bind/T-pose — for roughly the first third
  // of a second while "ROUND 1" sat on screen, then snapped into the correct
  // fighting stance. Root cause (see the long comment on `model.visible =
  // false` in `createFighter`, `fighter.ts`): `createFighter()` stays
  // synchronous, but the body glTF's skinned mesh renders at its rest/bind
  // pose the instant it is added to the scene, and nothing can drive it away
  // from that until the clip library — a SECOND async load nested inside the
  // body's own — resolves. `model.visible` now stays false until a real pose
  // has actually been driven through one mixer tick (or the clip load has
  // failed outright, which still reveals rather than hides forever), which is
  // what `FighterRig.visible()`/`inBindPose()` — and `bindPoseFlashSeen` on
  // the debug bridge, which LATCHES true the instant a real rendered frame
  // ever shows both at once — exist to prove against a real, undriven match.
  test('no fighter is ever rendered in its bind/T-pose, at match start or any round-open', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Needs real rendering for both the bone-rotation signal and the
    // screenshots below to mean anything — same self-skip as the other
    // real-GPU specs in this file.
    await page.goto('/');
    const renderer = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return 'none';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    test.skip(
      /swiftshader|llvmpipe|software|none/i.test(renderer),
      `software rasteriser (${renderer}) cannot sustain the render loop — run with --headed on a real GPU`
    );

    mkdirSync(SHOTS, { recursive: true });
    await startMatch(page, '/?fast=1&hold=1&draw=1', 0);

    // (b) LOOKED AT: screenshot the exact window the critic caught the flash
    // in — "ROUND 1" is on screen for `ROUND_INTRO_MS` before "FIGHT!" — at
    // roughly every 100ms across the first ~700ms, for a human/agent to
    // actually look at (see rollout step 1).
    const openingShots: string[] = [];
    for (let i = 0; i < 7; i++) {
      const path = join(SHOTS, `bindpose-open-${i}.png`);
      await page.screenshot({ path });
      openingShots.push(path);
      await page.waitForTimeout(100);
    }
    console.log('opening-window screenshots:', openingShots.join(', '));

    // Both fighters must actually become visible in short order — hidden
    // briefly while assets settle is the fix; hidden forever is the "leave a
    // fighter missing" failure mode G22 rules out just as firmly as the
    // bind-pose flash itself. Polled separately from the fixed-cadence
    // screenshot loop above so a slower asset load doesn't flake this.
    await page.waitForFunction(
      () => {
        const rigs = (window as any).__pf.rigs;
        return rigs?.p1.visible === true && rigs?.p2.visible === true;
      },
      null,
      { timeout: 10000, polling: 100 }
    );

    // (a) MEASURED, the core assertion: `bindPoseFlashSeen` latches inside the
    // app's own frame loop the instant ANY real rendered frame ever shows a
    // rig both visible and in its bind pose (see `main.ts`) — sampling every
    // frame from the moment the match starts, not merely the frames this test
    // happens to poll. Checked here (covers the opening) and again after
    // `matchEnd` below (covers every round-open reached in between too).
    const openingFlash = await page.evaluate(() => ({
      p1: (window as any).__pf.bindPoseFlashSeen('p1'),
      p2: (window as any).__pf.bindPoseFlashSeen('p2')
    }));
    expect(openingFlash, 'no bind pose observed in the opening window').toEqual({ p1: false, p2: false });

    // (c) ALSO CHECK ROUND TRANSITIONS: run the match to its real conclusion.
    // `bindPoseFlash` keeps accumulating the whole time, so this covers every
    // round-open boundary the transcript actually reaches — and since
    // `ROUNDS_TO_WIN` is 2, no match can end before round 2 opens (a single
    // round can only ever award one side ONE round win), so this is never a
    // weak check that happened to skip the round-open case.
    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 120000,
      polling: 100
    });

    const finalRound = await page.evaluate(() => {
      const ends = (window as any).__pf.events.filter((e: any) => e.type === 'roundEnd');
      return ends.length ? ends[ends.length - 1].round : 1;
    });
    console.log(`match ended having opened round ${finalRound}`);
    expect(
      finalRound,
      'the match reached at least a round-2 open (structural, see ROUNDS_TO_WIN)'
    ).toBeGreaterThanOrEqual(2);

    const finalFlash = await page.evaluate(() => ({
      p1: (window as any).__pf.bindPoseFlashSeen('p1'),
      p2: (window as any).__pf.bindPoseFlashSeen('p2')
    }));
    expect(
      finalFlash,
      'no bind pose observed across the whole match, including every round-open reached'
    ).toEqual({ p1: false, p2: false });

    expect(errors).toEqual([]);
  });
});
