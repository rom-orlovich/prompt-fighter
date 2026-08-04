import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  CHARACTER_MODELS,
  characterFor,
  characterSignature,
  characterAssetUrl,
  arenaHeight
} from '../src/roster/characters';
import { ROSTER } from '../src/fighters';

const NAMES = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'];

describe('character specs', () => {
  it('defines a spec for every roster fighter', () => {
    expect(Object.keys(CHARACTERS).sort()).toEqual([...NAMES].sort());
  });

  it('paints each fighter in its own brand colour', () => {
    for (const name of NAMES) {
      expect(characterFor(name).skin, name).toBe(ROSTER[name]!.color);
    }
    expect(new Set(NAMES.map((n) => characterFor(n).skin)).size).toBe(4);
  });

  it('assigns each fighter one of the four vendored KayKit models, with no repeats', () => {
    expect(CHARACTER_MODELS).toHaveLength(4);
    expect(new Set(CHARACTER_MODELS).size).toBe(4);
    const assigned = NAMES.map((n) => characterFor(n).model);
    for (const model of assigned) {
      expect(CHARACTER_MODELS as readonly string[], model).toContain(model);
    }
    expect(new Set(assigned).size, 'every fighter gets a different model').toBe(4);
  });

  it('gives every fighter a unique, non-empty description', () => {
    const descriptions = NAMES.map((n) => characterFor(n).description);
    expect(new Set(descriptions).size).toBe(4);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(0);
  });

  it('resolves every vendored model to a local, same-origin .glb path under the app base', () => {
    for (const model of CHARACTER_MODELS) {
      const url = characterAssetUrl(model, '/');
      expect(url).toBe(`/assets/characters/${model}.glb`);
      expect(url.startsWith('http')).toBe(false);
      expect(url.startsWith('//')).toBe(false);
    }
    expect(characterAssetUrl('Knight', '/prompt-fighter/')).toBe(
      '/prompt-fighter/assets/characters/Knight.glb'
    );
  });

  it('scales every fighter into the arena height band the camera is framed for', () => {
    // What matters on screen is the RENDERED height, not the raw multiplier: the
    // vendored models are 2.37-2.98 units tall on their own, so one shared scale
    // would size them very differently. The old procedural rigs put the head at
    // y=3.12, and a first pass at ~2x this band cropped every fighter at the
    // waist — hence asserting the derived height rather than the scale factor.
    for (const name of NAMES) {
      const height = arenaHeight(characterFor(name));
      expect(height, name).toBeGreaterThan(2.8);
      expect(height, name).toBeLessThan(3.9);
    }
    // Distinct silhouettes: the hulking barbarian must not render the same size
    // as the lightweight rogue.
    expect(new Set(NAMES.map((n) => arenaHeight(characterFor(n)))).size).toBe(4);
    expect(arenaHeight(characterFor('GEMINI'))).toBeGreaterThan(arenaHeight(characterFor('LOCAL 7B')));
  });

  it('falls back to a generic character for an unknown model', () => {
    const unknown = characterFor('MYSTERY-MODEL');
    expect(unknown.name).toBe('MYSTERY-MODEL');
    expect(CHARACTER_MODELS as readonly string[]).toContain(unknown.model);
    expect(NAMES.map((n) => characterSignature(characterFor(n)))).not.toContain(
      characterSignature(unknown)
    );
  });

  it('produces a unique signature per fighter', () => {
    const sigs = NAMES.map((n) => characterSignature(characterFor(n)));
    expect(new Set(sigs).size).toBe(4);
    for (const sig of sigs) expect(sig.length).toBeGreaterThan(0);
  });
});
