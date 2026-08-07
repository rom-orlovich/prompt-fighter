import { test, expect } from '@playwright/test';

/**
 * Records a genuine demo clip of the real render loop.
 *
 * Deliberately does NOT pass `?fast=1`: that flag skips `stage.start()` entirely,
 * which is what produced the previous demo's black void with the timer frozen at
 * 99. It also never clicks a character-select card, so p1 stays the transcript's
 * own fighter instead of being overridden into a mirror match.
 *
 * Needs a real GPU. Under headless software rendering (SwiftShader/llvmpipe) the
 * scene runs at ~2fps, and because `scene.ts` clamps each frame's delta to 0.05s
 * the arcade clock advances ~0.1s per real second — the match never meaningfully
 * progresses, so none of the assertions below could hold. Rather than weaken them
 * into something that passes without proving anything, the spec skips itself when
 * it detects a software rasteriser.
 *
 *   npx playwright test e2e/demo-recording.test.ts --headed   # real GPU, records
 */
test.describe('demo recording', () => {
  test('runs the real render loop with two different fighters and a live timer', async ({ page }) => {
    test.setTimeout(120000);

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

    const stageCards = page.locator('.stage-card');
    await expect(stageCards.first()).toBeVisible();
    await stageCards.first().click();

    // The matchup must be two DIFFERENT fighters — the previous demo recorded
    // CODEX vs CODEX because its spec clicked a select card that overrode p1.
    await page.waitForFunction(() => (window as any).__pf.selection !== null, null, { polling: 100 });
    const selection = await page.evaluate(() => (window as any).__pf.selection);
    expect(selection.p1.fighter).not.toBe(selection.p2.fighter);

    const readTimer = async () => Number(await page.locator('#timer').textContent());

    await page.waitForTimeout(1500);
    const started = await readTimer();
    expect(Number.isNaN(started)).toBe(false);

    // Let the match play far enough to show real combat, then stop — a full match
    // runs several rounds and would make an overlong demo clip.
    await page.waitForFunction(() => (window as any).__pf.events.length >= 12, null, {
      timeout: 60000,
      polling: 100
    });
    await page.waitForTimeout(8000);

    const later = await readTimer();
    expect(later, `timer should count down from ${started}`).toBeLessThan(started);

    // Real combat actually resolved, not just a clock ticking over an idle scene.
    const events = await page.evaluate(() => (window as any).__pf.events);
    expect(events.some((e: any) => e.type === 'attack')).toBe(true);
    expect(events.some((e: any) => e.type === 'hit')).toBe(true);

    expect(errors).toEqual([]);
  });
});
