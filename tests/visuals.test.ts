import { describe, it, expect } from 'vitest';
import { FIGHTER_VISUALS, visualFor, visualSignature } from '../src/roster/visuals';
import { buildFighterPlan, planSignature, HEAD_GEOMETRY } from '../src/render/fighter-plan';
import { profileFor } from '../src/fighters';

const ROSTER = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B', 'IRON_FIST', 'VIPER', 'WARDEN', 'BLAZE'];

describe('fighter visuals', () => {
  it('defines a visual for all eight fighters', () => {
    expect(Object.keys(FIGHTER_VISUALS).sort()).toEqual([...ROSTER].sort());
  });

  it('gives every fighter a distinct silhouette, colour and scale', () => {
    const visuals = ROSTER.map((n) => visualFor(n));
    for (const key of ['silhouette', 'color', 'accent', 'scale'] as const) {
      expect(new Set(visuals.map((v) => v[key])).size, `distinct ${key}`).toBe(8);
    }
  });

  it('uses all four legal head shapes, none used more than twice', () => {
    const visuals = ROSTER.map((n) => visualFor(n));
    const shapeCounts = new Map<string, number>();
    for (const v of visuals) shapeCounts.set(v.headShape, (shapeCounts.get(v.headShape) ?? 0) + 1);
    expect([...shapeCounts.keys()].sort(), 'all four legal shapes present').toEqual(
      ['box', 'crest', 'slabs', 'sphere'].sort()
    );
    for (const [shape, count] of shapeCounts) {
      expect(count, `${shape} used at most twice`).toBeLessThanOrEqual(2);
    }
  });

  it('gives every fighter distinct body proportions', () => {
    const visuals = ROSTER.map((n) => visualFor(n));
    expect(new Set(visuals.map((v) => v.torso.join(','))).size).toBe(8);
    expect(new Set(visuals.map((v) => v.shoulderWidth)).size).toBe(8);
  });

  it('produces a unique signature per fighter', () => {
    const sigs = ROSTER.map((n) => visualSignature(visualFor(n)));
    expect(new Set(sigs).size).toBe(8);
  });

  it('falls back to a generic visual for an unknown model', () => {
    const unknown = visualFor('MYSTERY-MODEL');
    expect(unknown.silhouette.length).toBeGreaterThan(0);
    expect(ROSTER.map((n) => visualFor(n).silhouette)).not.toContain(unknown.silhouette);
  });
});

describe('fighter geometry plan', () => {
  it('builds a distinct part plan per fighter', () => {
    const sigs = ROSTER.map((n) => planSignature(buildFighterPlan(visualFor(n))));
    expect(new Set(sigs).size).toBe(8);
  });

  it('uses the head geometry mapped from each silhouette', () => {
    for (const name of ROSTER) {
      const visual = visualFor(name);
      const head = buildFighterPlan(visual).find((p) => p.role === 'head');
      expect(head, `${name} head part`).toBeDefined();
      expect(head!.geometry.kind, `${name} head kind`).toBe(HEAD_GEOMETRY[visual.headShape]);
    }
  });

  it('gives every fighter exactly one readable screen and a full body', () => {
    for (const name of ROSTER) {
      const plan = buildFighterPlan(visualFor(name));
      expect(plan.filter((p) => p.role === 'screen'), `${name} screens`).toHaveLength(1);
      expect(plan.length, `${name} part count`).toBeGreaterThanOrEqual(12);
      expect(new Set(plan.map((p) => p.name)).size, `${name} unique part names`).toBe(plan.length);
    }
  });

  it('varies part counts so silhouettes differ in more than colour', () => {
    const counts = ROSTER.map((n) => buildFighterPlan(visualFor(n)).length);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(2);
  });
});

describe('roster profiles', () => {
  it('carries the visual spec on every profile', () => {
    for (const name of ROSTER) {
      expect(profileFor(name).visual.silhouette).toBe(visualFor(name).silhouette);
    }
  });

  it('carries a fallback visual for an unknown profile', () => {
    expect(profileFor('MYSTERY-MODEL').visual.silhouette).toBe(visualFor('MYSTERY-MODEL').silhouette);
  });
});
