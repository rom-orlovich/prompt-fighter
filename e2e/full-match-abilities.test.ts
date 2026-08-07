import { test, expect } from '@playwright/test';

/**
 * These specs drive a whole match (not just a slice of combat) through the real
 * UI — select screen → stage picker → replay → engine → renderer — using
 * `?fast=1` to compress the arcade pacing, and read the outcome back through the
 * `window.__pf` debug bridge instead of racing DOM animations or reading pixels.
 *
 * The engine is fully deterministic (no RNG anywhere in analyzer/combat/abilities),
 * so a given fighter matchup against a given bundled transcript always plays out
 * identically — the assertions below were verified against that same determinism
 * headlessly before being written.
 */

test.describe('full match with abilities', () => {
  test('replays a full fast bundled-transcript match end-to-end and fires ability events', async ({ page }) => {
    // The playwright.config.ts `workers`/`retries` comments document real WebGL/CPU
    // contention on a shared box that can starve a frame loop enough to brush the
    // default 30000ms test timeout even though nothing about the app is broken
    // (confirmed by re-running the same spec standalone, where it consistently
    // passes on the first attempt in ~25-28s). Widening both this test's own
    // timeout AND the `waitForFunction` below (25000ms -> 45000ms) gives real
    // headroom against that transient contention without masking an actual hang —
    // a genuine hang still fails, just at 45s/60s instead of a razor-thin 25s/30s
    // margin that was tripping on nothing but scheduling jitter.
    test.setTimeout(60000);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/?fast=1');

    // The debug bridge and the static roster are wired before any match starts.
    const rosterKeys = await page.evaluate(() => Object.keys((window as any).__pf.roster));
    expect(rosterKeys.sort()).toEqual(['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B']);
    expect(await page.evaluate(() => (window as any).__pf.matchEnded)).toBe(false);
    expect(await page.evaluate(() => (window as any).__pf.selection)).toBeNull();

    // Pick the CODEX card as the player's fighter — a deliberate override, not
    // the microservices transcript's own default p1 (CLAUDE).
    const cards = page.locator('.fighter-card');
    await expect(cards).toHaveCount(4);
    const codex = page.locator('.fighter-card[data-fighter="CODEX"]');
    await expect(codex).toHaveCount(1);
    await codex.click();
    await expect(codex).toHaveClass(/selected/);

    // Start the "should a 3-person team use microservices?" stage (CLAUDE vs CODEX).
    const stageCards = page.locator('.stage-card');
    await expect(stageCards.first()).toBeVisible();
    await stageCards.first().click();

    // The player's card overrides p1: with CODEX picked, this becomes a CODEX vs
    // CODEX matchup even though the transcript's own p1 is CLAUDE.
    await page.waitForFunction(() => (window as any).__pf.selection !== null, null, { polling: 100 });
    const selection = await page.evaluate(() => (window as any).__pf.selection);
    expect(selection.p1.fighter).toBe('CODEX');
    expect(selection.p1.source).toBe('transcript');
    expect(selection.p2.fighter).toBe('CODEX');

    // Let the fast-paced match play all the way to a decision.
    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 45000,
      polling: 100
    });

    const events = await page.evaluate(() => (window as any).__pf.events);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e: any) => e.type === 'attack')).toBe(true);
    expect(events.some((e: any) => e.type === 'hit')).toBe(true);
    expect(events.some((e: any) => e.type === 'ko')).toBe(true);
    expect(events.some((e: any) => e.type === 'matchEnd')).toBe(true);

    const abilityEvents = events.filter((e: any) => e.type === 'ability');
    expect(abilityEvents.length).toBeGreaterThan(0);
    for (const e of abilityEvents) {
      expect(['p1', 'p2']).toContain(e.by);
      expect(e.owner).toBe('CODEX');
      expect(typeof e.name).toBe('string');
      expect(e.name.length).toBeGreaterThan(0);
      expect(typeof e.amount).toBe('number');
    }
    // Both of CODEX's abilities (one passive, one super) are exercised by this matchup.
    expect(new Set(abilityEvents.map((e: any) => e.ability))).toEqual(
      new Set(['SHIP_IT_RUSH', 'CONFIDENT_FABRICATION'])
    );

    // The result card surfaces once the match concludes.
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 5000 });

    expect(errors).toEqual([]);
  });

  test('exposes a headless simulate() bridge that resolves a full match deterministically', async ({
    page
  }) => {
    await page.goto('/?fast=1');

    const result = await page.evaluate(() => (window as any).__pf.simulate('tabs-vs-spaces.json'));

    expect(result.matchOver).toBe(true);
    expect(result.events.some((e: any) => e.type === 'matchEnd')).toBe(true);
    expect(result.events.some((e: any) => e.type === 'ability')).toBe(true);
    expect(result.state.p1.roundsWon + result.state.p2.roundsWon).toBeGreaterThanOrEqual(2);
  });
});
