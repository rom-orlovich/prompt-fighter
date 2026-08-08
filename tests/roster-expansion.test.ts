import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  BODIES,
  HAIRSTYLES,
  characterFor,
  characterSignature,
  arenaHeight
} from '../src/roster/characters';
import { FIGHTER_VISUALS, visualFor, visualSignature } from '../src/roster/visuals';
import { ROSTER, profileFor } from '../src/fighters';
import { FIGHTER_IDS, selectFighter } from '../src/engine/selection';
import { SUPER_NAMES } from '../src/engine/combat';

/**
 * Roster expansion 4 -> 8. The vendored free tier ships TWO bodies and FOUR
 * hairstyles, i.e. exactly EIGHT unique body+hair combinations — which is why
 * eight fighters need no new mesh, and why "unique hairstyle per fighter" is
 * replaced here by "unique body+hair COMBINATION per fighter" as the
 * load-bearing distinctness invariant.
 */
const NEW_NAMES = ['IRON_FIST', 'VIPER', 'WARDEN', 'BLAZE'] as const;
const OLD_NAMES = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'] as const;
const ALL_NAMES = [...OLD_NAMES, ...NEW_NAMES];

describe('roster expansion to eight fighters', () => {
  it('registers all eight fighters in every roster table', () => {
    expect(Object.keys(ROSTER).sort()).toEqual([...ALL_NAMES].sort());
    expect(Object.keys(CHARACTERS).sort()).toEqual([...ALL_NAMES].sort());
    expect(Object.keys(FIGHTER_VISUALS).sort()).toEqual([...ALL_NAMES].sort());
    expect([...FIGHTER_IDS].sort()).toEqual([...ALL_NAMES].sort());
  });

  it('leaves the original four fighters untouched', () => {
    expect(characterFor('CLAUDE')).toMatchObject({
      body: 'Male',
      hair: 'Hair_SimpleParted',
      skin: 0xd97757,
      modelScale: 1.79,
      bulk: 0.97
    });
    expect(characterFor('CODEX')).toMatchObject({
      body: 'Male',
      hair: 'Hair_Beard',
      skin: 0x10a37f,
      modelScale: 1.87,
      bulk: 1.1
    });
    expect(characterFor('GEMINI')).toMatchObject({
      body: 'Male',
      hair: 'Hair_Buzzed',
      skin: 0x4285f4,
      modelScale: 2.0,
      bulk: 1.15
    });
    expect(characterFor('LOCAL 7B')).toMatchObject({
      body: 'Female',
      hair: 'Hair_Long',
      skin: 0xa855f7,
      modelScale: 1.66,
      bulk: 0.9
    });
  });

  it('gives every new fighter a complete CharacterSpec built from vendored assets', () => {
    for (const name of NEW_NAMES) {
      const spec = characterFor(name);
      expect(spec.name, name).toBe(name);
      expect(BODIES as readonly string[], name).toContain(spec.body);
      expect(HAIRSTYLES as readonly string[], name).toContain(spec.hair);
      expect(spec.description.length, `${name} description`).toBeGreaterThan(20);
      expect(spec.skin, `${name} skin`).toBeGreaterThan(0);
      expect(spec.bulk, `${name} bulk`).toBeGreaterThanOrEqual(0.85);
      expect(spec.bulk, `${name} bulk`).toBeLessThanOrEqual(1.2);
    }
  });

  it('keeps every fighter visually separable: unique body+hair, tint, height, build and description', () => {
    const combos = ALL_NAMES.map((n) => `${characterFor(n).body}/${characterFor(n).hair}`);
    expect(new Set(combos).size, 'unique body+hair per fighter').toBe(8);
    expect(new Set(ALL_NAMES.map((n) => characterFor(n).skin)).size, 'unique tint').toBe(8);
    expect(new Set(ALL_NAMES.map((n) => characterFor(n).bulk)).size, 'unique build').toBe(8);
    expect(new Set(ALL_NAMES.map((n) => arenaHeight(characterFor(n)))).size, 'unique height').toBe(8);
    expect(new Set(ALL_NAMES.map((n) => characterFor(n).description)).size, 'unique description').toBe(8);
    expect(new Set(ALL_NAMES.map((n) => characterSignature(characterFor(n)))).size).toBe(8);
  });

  it('keeps every fighter inside the arena height band the camera is framed for', () => {
    for (const name of ALL_NAMES) {
      const height = arenaHeight(characterFor(name));
      expect(height, name).toBeGreaterThan(2.8);
      expect(height, name).toBeLessThan(3.9);
    }
  });

  it('paints every fighter in its own brand colour, consistently across tables', () => {
    for (const name of ALL_NAMES) {
      expect(characterFor(name).skin, `${name} skin == ROSTER color`).toBe(ROSTER[name]!.color);
      expect(visualFor(name).color, `${name} visual color`).toBe(ROSTER[name]!.color);
      expect(visualFor(name).accent, `${name} visual accent`).toBe(ROSTER[name]!.accent);
    }
    expect(new Set(ALL_NAMES.map((n) => ROSTER[n]!.color)).size).toBe(8);
    expect(new Set(ALL_NAMES.map((n) => ROSTER[n]!.accent)).size).toBe(8);
  });

  it('gives every new fighter a real profile: tagline, super name and its own visual', () => {
    for (const name of NEW_NAMES) {
      const profile = profileFor(name);
      expect(profile.name).toBe(name);
      expect(profile.tagline.length, `${name} tagline`).toBeGreaterThan(3);
      expect(profile.superName.length, `${name} superName`).toBeGreaterThan(3);
      expect(profile.visual.silhouette).toBe(visualFor(name).silhouette);
      expect(profile.visual.silhouette, `${name} must not fall back`).not.toBe(
        visualFor('MYSTERY-MODEL').silhouette
      );
    }
    expect(new Set(ALL_NAMES.map((n) => ROSTER[n]!.tagline)).size).toBe(8);
    expect(new Set(ALL_NAMES.map((n) => ROSTER[n]!.superName)).size).toBe(8);
    expect(new Set(ALL_NAMES.map((n) => visualSignature(visualFor(n)))).size).toBe(8);
  });

  it('announces every fighter super under its own name, without changing the unknown-model fallback', () => {
    for (const name of ALL_NAMES) {
      expect(SUPER_NAMES[name], name).toBe(ROSTER[name]!.superName);
    }
    expect(SUPER_NAMES['MYSTERY-MODEL']).toBeUndefined();
  });

  it('lets a transcript name any of the new fighters, in any casing', () => {
    for (const name of NEW_NAMES) {
      const picked = selectFighter({
        modelName: 'some-random-model',
        transcriptFighter: name.toLowerCase()
      });
      expect(picked.fighter, name).toBe(name);
      expect(picked.source, name).toBe('transcript');
    }
  });

  it('still spreads hashed model names across the widened roster', () => {
    const models = [
      'gpt-4o',
      'llama-3-70b',
      'qwen2.5-coder',
      'deepseek-v3',
      'phi-4',
      'mixtral-8x7b',
      'command-r',
      'yi-34b',
      'gemma-2',
      'nemotron'
    ];
    const picked = new Set(models.map((m) => selectFighter({ modelName: m }).fighter));
    expect(picked.size).toBeGreaterThanOrEqual(2);
    for (const fighter of picked) expect(FIGHTER_IDS as readonly string[]).toContain(fighter);
  });

  it('reuses each vendored hairstyle exactly twice, so no mesh is wasted or overloaded', () => {
    const counts = new Map<string, number>();
    for (const name of ALL_NAMES) {
      const hair = characterFor(name).hair;
      counts.set(hair, (counts.get(hair) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...HAIRSTYLES].sort());
    for (const [hair, count] of counts) expect(count, hair).toBe(2);
    const bodies = ALL_NAMES.map((n) => characterFor(n).body);
    expect(bodies.filter((b) => b === 'Male').length).toBe(4);
    expect(bodies.filter((b) => b === 'Female').length).toBe(4);
  });
});
