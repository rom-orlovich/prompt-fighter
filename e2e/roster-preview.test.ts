import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D3 evidence capture, doubling as the select-screen regression test for the
 * 4 -> 8 roster expansion: every new fighter must actually render a real,
 * non-blank, visually distinct preview in the select screen before its PNG is
 * written. Readiness is polled (never a fixed delay) for the same reason the
 * rest of this suite polls: eight live WebGL contexts under software
 * rasterisation take a variable, contention-dependent time to draw a first frame.
 */
const OUT_DIR = '/tmp/prompt-fighter-roster-preview';
const NEW_FIGHTERS = ['IRON_FIST', 'VIPER', 'WARDEN', 'BLAZE'] as const;
const ALL_FIGHTERS = [
  'BLAZE',
  'CLAUDE',
  'CODEX',
  'GEMINI',
  'IRON_FIST',
  'LOCAL 7B',
  'VIPER',
  'WARDEN'
];

/** PNG magic bytes — proves each capture is a real image, not a 0-byte stub. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe('roster preview capture (eight-fighter select screen)', () => {
  test('renders and captures each new fighter on the select screen', async ({ page }) => {
    test.setTimeout(120000);
    mkdirSync(OUT_DIR, { recursive: true });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');

    const cards = page.locator('.fighter-card');
    await expect(cards).toHaveCount(8);
    await expect(cards.first()).toBeVisible();

    const names = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.fighter ?? '')
    );
    expect([...names].sort()).toEqual(ALL_FIGHTERS);

    await page.waitForFunction(
      () => {
        const canvases = Array.from(
          document.querySelectorAll('.fighter-preview')
        ) as HTMLCanvasElement[];
        return (
          canvases.length === 8 && canvases.every((c) => c.toDataURL('image/png').length > 2000)
        );
      },
      null,
      { timeout: 90000, polling: 250 }
    );

    for (const name of NEW_FIGHTERS) {
      const card = page.locator(`.fighter-card[data-fighter="${name}"]`);
      await expect(card, `${name} card exists`).toHaveCount(1);
      await expect(card).toBeVisible();

      const path = join(OUT_DIR, `${name}.png`);
      await card.screenshot({ path });

      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 8).equals(PNG_MAGIC), `${name}.png is a real PNG`).toBe(true);
      expect(statSync(path).size, `${name}.png size`).toBeGreaterThan(3000);
    }

    await page.locator('.select-grid').screenshot({ path: join(OUT_DIR, 'roster-all-8.png') });

    const shots = await page
      .locator('.fighter-preview')
      .evaluateAll((els) => els.map((c) => (c as HTMLCanvasElement).toDataURL('image/png')));
    expect(shots).toHaveLength(8);
    for (const shot of shots) {
      expect(shot.startsWith('data:image/png;base64,')).toBe(true);
      expect(shot.length, 'preview is not blank').toBeGreaterThan(2000);
    }
    expect(new Set(shots).size, 'eight visually distinct previews').toBe(8);

    expect(errors).toEqual([]);
  });

  test('lets the player pick one of the new fighters', async ({ page }) => {
    await page.goto('/');
    const viper = page.locator('.fighter-card[data-fighter="VIPER"]');
    await expect(viper).toHaveCount(1);
    await viper.click();
    await expect(viper).toHaveClass(/selected/);
    await expect(page.locator('.fighter-card.selected')).toHaveCount(1);
  });
});
