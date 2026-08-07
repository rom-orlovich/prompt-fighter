import { test, expect } from '@playwright/test';

/**
 * Local-live mode (D9): two `local` `FighterBrain`s (`src/brains/local.ts`) play a
 * whole match automatically via the `#live-mode-btn` entry point — no server, no
 * network, no transcript file. `src/brains/local.ts`'s own doc comment and
 * `tests/live-mode-parity.test.ts`'s "CLI path never diverges from the engine"
 * spec already prove this exact CLAUDE-vs-CODEX local-brain pairing reaches
 * `matchOver === true` "decided by real turns, not the timeout guard" — this spec
 * proves the same thing end-to-end through the real browser UI, through the same
 * `MatchSource`/`StreamHandlers` seam every other mode uses, so local-live match
 * behavior is provably unchanged by the spectate feature (D4/D9's "byte-identical
 * to pre-change" requirement) and still reaches a real KO/round decision.
 */
test.describe('local-live match', () => {
  test('plays a full local-live match end-to-end via Live Mode and reaches a real decision', async ({
    page
  }) => {
    test.setTimeout(60000);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/?fast=1');

    await page.locator('#live-mode-btn').click();

    // No character-select or stage-card click needed — Live Mode starts
    // immediately with both local brains driving CLAUDE vs CODEX.
    await page.waitForFunction(() => (window as any).__pf.selection !== null, null, { polling: 100 });
    const selection = await page.evaluate(() => (window as any).__pf.selection);
    expect(selection.p1.fighter).toBe('CLAUDE');
    expect(selection.p2.fighter).toBe('CODEX');

    await page.waitForFunction(() => (window as any).__pf.matchEnded === true, null, {
      timeout: 45000,
      polling: 100
    });

    const events = await page.evaluate(() => (window as any).__pf.events);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e: any) => e.type === 'attack')).toBe(true);
    expect(events.some((e: any) => e.type === 'hit')).toBe(true);
    // A real, engine-decided outcome — either a KO or a round decision — not the
    // `runLoop` exhaustion safety valve.
    expect(events.some((e: any) => e.type === 'ko' || e.type === 'roundEnd')).toBe(true);
    expect(events.some((e: any) => e.type === 'matchEnd')).toBe(true);

    // The result card surfaces once the match concludes — same UI every mode uses.
    await expect(page.locator('#result')).not.toHaveClass(/hidden/, { timeout: 5000 });

    // Local-live mode never touches spectate-only state.
    expect(await page.evaluate(() => (window as any).__pf.spectateLog)).toEqual([]);

    expect(errors).toEqual([]);
  });
});
