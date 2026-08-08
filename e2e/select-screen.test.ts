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
    await expect(cards).toHaveCount(8);
    await expect(cards.first()).toBeVisible();

    const names = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.fighter ?? '')
    );
    expect([...names].sort()).toEqual([
      'BLAZE',
      'CLAUDE',
      'CODEX',
      'GEMINI',
      'IRON_FIST',
      'LOCAL 7B',
      'VIPER',
      'WARDEN'
    ]);

    for (const attr of ['color', 'silhouette', 'scale']) {
      const values = await cards.evaluateAll(
        (els, key) => els.map((e) => (e as HTMLElement).dataset[key as string] ?? ''),
        attr
      );
      expect(values.every((v) => v.length > 0), `data-${attr} populated`).toBe(true);
      expect(new Set(values).size, `distinct data-${attr}`).toBe(8);
    }

    // Only FOUR legal head shapes exist in the vendored asset set, so eight
    // fighters cannot all have a distinct `data-head` — at least four unique
    // values (every shape used at least once) is the real invariant here.
    const heads = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.head ?? '')
    );
    expect(heads.every((v) => v.length > 0), 'data-head populated').toBe(true);
    expect(new Set(heads).size, 'distinct data-head').toBeGreaterThanOrEqual(4);

    const abilities = await cards.evaluateAll((els) =>
      els.map((e) => ({
        fighter: (e as HTMLElement).dataset.fighter ?? '',
        abilities: ((e as HTMLElement).dataset.abilities ?? '').split(',').filter(Boolean)
      }))
    );
    const ORIGINAL_FOUR = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'];
    const NEW_FOUR = ['BLAZE', 'IRON_FIST', 'VIPER', 'WARDEN'];
    const originalAbilities = abilities.filter((a) => ORIGINAL_FOUR.includes(a.fighter));
    const newAbilities = abilities.filter((a) => NEW_FOUR.includes(a.fighter));
    expect(originalAbilities).toHaveLength(4);
    expect(
      originalAbilities.every((a) => a.abilities.length === 2),
      'two abilities per original fighter'
    ).toBe(true);
    expect(
      new Set(originalAbilities.flatMap((a) => a.abilities)).size,
      'eight unique abilities across the original four'
    ).toBe(8);
    // The four new fighters (IRON_FIST/VIPER/WARDEN/BLAZE) ship with zero
    // abilities/FX for now — giving them real abilities and matching combat
    // FX is a documented follow-up, not part of this roster-wiring subtask.
    expect(newAbilities).toHaveLength(4);
    expect(
      newAbilities.every((a) => a.abilities.length === 0),
      'new fighters have no abilities yet (follow-up)'
    ).toBe(true);

    const previews = page.locator('.fighter-preview');
    await expect(previews).toHaveCount(8);

    // Poll for the preview renderers to have actually drawn a real (non-blank) frame
    // each, instead of guessing a fixed delay is "enough time" — under contention a
    // fixed wait is exactly the readiness race this suite has been hardened against
    // elsewhere (see the `polling: 100` waitForFunction calls in the other specs).
    // Timeout raised 45000 -> 90000: eight live WebGL contexts under software
    // rasterisation take meaningfully longer to all draw a first frame than four did.
    await page.waitForFunction(
      () => {
        const canvases = Array.from(
          document.querySelectorAll('.fighter-preview')
        ) as HTMLCanvasElement[];
        return (
          canvases.length === 8 &&
          canvases.every((c) => c.toDataURL('image/png').length > 2000)
        );
      },
      null,
      { timeout: 90000, polling: 200 }
    );
    const shots = await previews.evaluateAll((els) =>
      els.map((c) => (c as HTMLCanvasElement).toDataURL('image/png'))
    );
    expect(shots).toHaveLength(8);
    for (const shot of shots) {
      expect(shot.startsWith('data:image/png;base64,')).toBe(true);
      expect(shot.length, 'preview is not blank').toBeGreaterThan(2000);
    }
    expect(new Set(shots).size, 'eight visually distinct previews').toBe(8);

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
