import { test, expect } from '@playwright/test';

test.describe('character select screen', () => {
  test('renders four visually distinct fighters on startup', async ({ page }) => {
    // Reading the preview canvases requires them to have actually drawn a real frame
    // first, which — like every other WebGL-driven readiness check in this suite —
    // can take meaningfully longer than a hopeful fixed delay under the CPU
    // contention `fullyParallel` parallel Chromium instances create. A fixed
    // `waitForTimeout` before reading pixels is exactly that hopeful-guess pattern;
    // give this one real headroom rather than a best-effort budget.
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');

    const cards = page.locator('.fighter-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toBeVisible();

    const names = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.fighter ?? '')
    );
    expect([...names].sort()).toEqual(['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B']);

    for (const attr of ['color', 'head', 'silhouette', 'scale']) {
      const values = await cards.evaluateAll(
        (els, key) => els.map((e) => (e as HTMLElement).dataset[key as string] ?? ''),
        attr
      );
      expect(values.every((v) => v.length > 0), `data-${attr} populated`).toBe(true);
      expect(new Set(values).size, `distinct data-${attr}`).toBe(4);
    }

    const abilities = await cards.evaluateAll((els) =>
      els.map((e) => ((e as HTMLElement).dataset.abilities ?? '').split(',').filter(Boolean))
    );
    expect(abilities.every((list) => list.length === 2), 'two abilities per fighter').toBe(true);
    expect(new Set(abilities.flat()).size, 'eight unique abilities').toBe(8);

    const previews = page.locator('.fighter-preview');
    await expect(previews).toHaveCount(4);

    // Poll for the preview renderers to have actually drawn a real (non-blank) frame
    // each, instead of guessing a fixed delay is "enough time" — under contention a
    // fixed wait is exactly the readiness race this suite has been hardened against
    // elsewhere (see the `polling: 100` waitForFunction calls in the other specs).
    await page.waitForFunction(
      () => {
        const canvases = Array.from(
          document.querySelectorAll('.fighter-preview')
        ) as HTMLCanvasElement[];
        return (
          canvases.length === 4 &&
          canvases.every((c) => c.toDataURL('image/png').length > 2000)
        );
      },
      null,
      { timeout: 45000, polling: 200 }
    );
    const shots = await previews.evaluateAll((els) =>
      els.map((c) => (c as HTMLCanvasElement).toDataURL('image/png'))
    );
    expect(shots).toHaveLength(4);
    for (const shot of shots) {
      expect(shot.startsWith('data:image/png;base64,')).toBe(true);
      expect(shot.length, 'preview is not blank').toBeGreaterThan(2000);
    }
    expect(new Set(shots).size, 'four visually distinct previews').toBe(4);

    expect(errors).toEqual([]);
  });

  test('lets the player pick a fighter card', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.fighter-card');
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveClass(/selected/);
    await expect(page.locator('.fighter-card.selected')).toHaveCount(1);
  });
});
