import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  CHARACTER_MODEL,
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

  it('puts every fighter on the one shared realistic rig', () => {
    // The roster deliberately traded four distinct chibi models for one
    // realistically-proportioned humanoid; distinctness now comes from tint,
    // height and build rather than from separate meshes.
    for (const name of NAMES) {
      expect(characterFor(name).model, name).toBe(CHARACTER_MODEL);
    }
  });

  it('separates the fighters by build as well as height', () => {
    const bulks = NAMES.map((n) => characterFor(n).bulk);
    expect(new Set(bulks).size, 'every fighter has its own build').toBe(4);
    for (const bulk of bulks) {
      // Past roughly this range a stretched skinned humanoid reads as broken
      // rather than as heavyset.
      expect(bulk).toBeGreaterThanOrEqual(0.85);
      expect(bulk).toBeLessThanOrEqual(1.2);
    }
    expect(characterFor('GEMINI').bulk).toBeGreaterThan(characterFor('LOCAL 7B').bulk);
  });

  it('gives every fighter a unique, non-empty description', () => {
    const descriptions = NAMES.map((n) => characterFor(n).description);
    expect(new Set(descriptions).size).toBe(4);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(0);
  });

  it('resolves the vendored rig to a local, same-origin .glb path under the app base', () => {
    const url = characterAssetUrl(CHARACTER_MODEL, '/');
    expect(url).toBe(`/assets/characters/${CHARACTER_MODEL}.glb`);
    expect(url.startsWith('http')).toBe(false);
    expect(url.startsWith('//')).toBe(false);
    expect(characterAssetUrl(CHARACTER_MODEL, '/prompt-fighter/')).toBe(
      '/prompt-fighter/assets/characters/Fighter.glb'
    );
  });

  it('scales every fighter into the arena height band the camera is framed for', () => {
    // What matters on screen is the RENDERED height, not the raw multiplier.
    // The old procedural rigs put the head at y=3.12, and a pass at ~2x this
    // band cropped every fighter at the waist — hence asserting the derived
    // height rather than the scale factor.
    for (const name of NAMES) {
      const height = arenaHeight(characterFor(name));
      expect(height, name).toBeGreaterThan(2.8);
      expect(height, name).toBeLessThan(3.9);
    }
    // Distinct silhouettes: the heavyweight must not render the same size as
    // the featherweight.
    expect(new Set(NAMES.map((n) => arenaHeight(characterFor(n)))).size).toBe(4);
    expect(arenaHeight(characterFor('GEMINI'))).toBeGreaterThan(arenaHeight(characterFor('LOCAL 7B')));
  });

  it('falls back to a generic character for an unknown model', () => {
    const unknown = characterFor('MYSTERY-MODEL');
    expect(unknown.name).toBe('MYSTERY-MODEL');
    expect(unknown.model).toBe(CHARACTER_MODEL);
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
