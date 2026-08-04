import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateGlbStructure } from '../scripts/validate-glb.mjs';
import { readGlb } from '../scripts/gltf-to-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');
const MODELS = ['Barbarian', 'Knight', 'Mage', 'Rogue'];
const MAX_COMBINED_BYTES = 5 * 1024 * 1024;
const EXPECTED_CLIPS = ['Idle', 'Blocking', 'Unarmed_Melee_Attack_Punch_A', 'Block', 'Hit_A', 'Death_A', 'Cheer'].sort();

describe('vendored character assets', () => {
  it('ships exactly the four named KayKit character models', () => {
    for (const model of MODELS) {
      expect(() => statSync(join(ASSETS_DIR, `${model}.glb`)), `${model}.glb should exist`).not.toThrow();
    }
  });

  it('is structurally valid for every vendored character', () => {
    for (const model of MODELS) {
      const glb = readFileSync(join(ASSETS_DIR, `${model}.glb`));
      const result = validateGlbStructure(new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength));
      expect(result.errors, `${model}.glb structural errors`).toEqual([]);
      expect(result.valid, model).toBe(true);
    }
  });

  it('keeps the combined vendored payload under 5MB', () => {
    const total = MODELS.reduce((sum, model) => sum + statSync(join(ASSETS_DIR, `${model}.glb`)).size, 0);
    expect(total, `combined bytes: ${total}`).toBeLessThan(MAX_COMBINED_BYTES);
  });

  it('every vendored file keeps only the 7 pose-mapped animation clips', () => {
    for (const model of MODELS) {
      const glb = readFileSync(join(ASSETS_DIR, `${model}.glb`));
      const { json } = readGlb(new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength));
      const names = (json.animations ?? []).map((a: { name: string }) => a.name).sort();
      expect(names, model).toEqual(EXPECTED_CLIPS);
    }
  });
});
