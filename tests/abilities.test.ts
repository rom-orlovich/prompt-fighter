import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ABILITIES, FIGHTER_ABILITIES, abilitiesFor, applyAbilities } from '../src/engine/abilities';
import { newMatch, resolve } from '../src/engine/combat';
import { simulateTranscript } from '../src/engine/simulate';
import { MAX_METER } from '../src/engine/types';
import type { CombatEvent, MoveIntent } from '../src/engine/types';
import type { Transcript } from '../src/sources/types';

const ROSTER = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'];

function intent(over: Partial<MoveIntent> = {}): MoveIntent {
  return {
    kind: 'STRIKE',
    power: 10,
    tags: [],
    continuesThread: false,
    meterGain: 5,
    selfDamage: 0,
    label: 'TEST',
    ...over
  };
}

const abilityEvents = (evts: CombatEvent[]) =>
  evts.filter((e): e is Extract<CombatEvent, { type: 'ability' }> => e.type === 'ability');

function transcript(file: string): Transcript {
  return JSON.parse(
    readFileSync(new URL(`../public/transcripts/${file}`, import.meta.url), 'utf8')
  ) as Transcript;
}

describe('ability catalog', () => {
  it('gives each fighter exactly two abilities, unique across the roster', () => {
    const all: string[] = [];
    for (const name of ROSTER) {
      const pair = abilitiesFor(name);
      expect(pair, `${name} abilities`).toHaveLength(2);
      all.push(...pair);
    }
    expect(new Set(all).size).toBe(8);
  });

  it('describes every ability with a name, owner and mechanical effect', () => {
    const ids = Object.keys(ABILITIES) as (keyof typeof ABILITIES)[];
    expect(ids).toHaveLength(8);
    for (const id of ids) {
      const def = ABILITIES[id];
      expect(def.name.length).toBeGreaterThan(0);
      expect(ROSTER).toContain(def.owner);
      expect(def.effects.length).toBeGreaterThan(0);
      expect(['super', 'passive']).toContain(def.kind);
    }
  });

  it('maps every fighter in FIGHTER_ABILITIES', () => {
    expect(Object.keys(FIGHTER_ABILITIES).sort()).toEqual([...ROSTER].sort());
  });

  it('returns no abilities for an unknown model', () => {
    expect(abilitiesFor('MYSTERY-MODEL')).toHaveLength(0);
  });
});

describe('per-fighter mechanics', () => {
  it("CODEX's SHIP IT RUSH boosts damage on an assertive line", () => {
    const boosted = newMatch('p1', 'CLAUDE', 'CODEX');
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ tags: ['assertive'] }),
      playerAction: 'NONE',
      state: boosted
    });
    const plain = newMatch('p1', 'CLAUDE', 'GEMINI');
    resolve({
      attacker: 'p2',
      intent: intent({ tags: ['assertive'] }),
      playerAction: 'NONE',
      state: plain
    });
    expect(boosted.p1.credibility).toBeLessThan(plain.p1.credibility);
    expect(abilityEvents(evts).map((e) => e.ability)).toContain('SHIP_IT_RUSH');
  });

  it("CLAUDE's NUANCE RIPOSTE heals on a YES, BUT parry", () => {
    const s = newMatch('p1', 'CLAUDE', 'CODEX');
    s.p1.credibility = 60;
    const evts = resolve({
      attacker: 'p1',
      intent: intent({ kind: 'PARRY', power: 9 }),
      playerAction: 'NONE',
      state: s
    });
    expect(s.p1.credibility).toBeGreaterThan(60);
    expect(
      abilityEvents(evts).some((e) => e.ability === 'NUANCE_RIPOSTE' && e.effect === 'heal')
    ).toBe(true);
  });

  it("GEMINI's MULTIMODAL RECALL adds meter on cited evidence", () => {
    const gemini = newMatch('p1', 'GEMINI', 'CODEX');
    const evts = resolve({
      attacker: 'p1',
      intent: intent({ kind: 'CRIT', power: 12 }),
      playerAction: 'NONE',
      state: gemini
    });
    const other = newMatch('p1', 'CLAUDE', 'CODEX');
    resolve({
      attacker: 'p1',
      intent: intent({ kind: 'CRIT', power: 12 }),
      playerAction: 'NONE',
      state: other
    });
    expect(gemini.p1.meter).toBeGreaterThan(other.p1.meter);
    expect(abilityEvents(evts).some((e) => e.ability === 'MULTIMODAL_RECALL')).toBe(true);
  });

  it("LOCAL 7B's QUANTIZED GLITCH trades self damage for extra jab damage", () => {
    const s = newMatch('p1', 'CLAUDE', 'LOCAL 7B');
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ kind: 'JAB', power: 6 }),
      playerAction: 'NONE',
      state: s
    });
    expect(s.p2.credibility).toBeLessThan(100);
    const fired = abilityEvents(evts).filter((e) => e.ability === 'QUANTIZED_GLITCH');
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.map((e) => e.effect)).toContain('selfDamage');
  });

  it("LOCAL 7B's FAST INFERENCE banks its advertised +20 meter after spending the super", () => {
    const s = newMatch('p1', 'LOCAL 7B', 'CLAUDE');
    s.p1.meter = MAX_METER;
    const evts = resolve({ attacker: 'p1', intent: intent(), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'super' && e.name === 'FAST INFERENCE')).toBe(true);
    expect(abilityEvents(evts)).toContainEqual(
      expect.objectContaining({ ability: 'FAST_INFERENCE', effect: 'meter', amount: 20 })
    );
    expect(s.p1.meter).toBe(20);
    expect(evts.filter((e) => e.type === 'meter').at(-1)).toEqual({
      type: 'meter',
      who: 'p1',
      value: 20
    });
  });

  it('fires a distinctly shaped super for each fighter', () => {
    const shapes: string[] = [];
    for (const name of ROSTER) {
      const s = newMatch('p2', name, 'CLAUDE');
      s.p1.meter = MAX_METER;
      const evts = resolve({ attacker: 'p1', intent: intent(), playerAction: 'NONE', state: s });
      expect(evts.some((e) => e.type === 'super'), `${name} super event`).toBe(true);
      const fired = abilityEvents(evts).filter((e) => e.owner === name);
      expect(fired.length, `${name} super ability events`).toBeGreaterThan(0);
      shapes.push(fired.map((e) => e.effect).sort().join('+'));
    }
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(3);
  });

  it('applyAbilities is pure and deterministic', () => {
    const ctx = {
      fighterName: 'CODEX',
      intent: intent({ tags: ['assertive'] }),
      attacker: 'p1' as const,
      isSuper: false,
      baseDamage: 10
    };
    expect(applyAbilities(ctx)).toEqual(applyAbilities(ctx));
  });

  it('leaves an unknown fighter on the legacy super behaviour', () => {
    const s = newMatch('p1', 'CLAUDE', 'MYSTERY-MODEL');
    s.p2.meter = MAX_METER;
    const evts = resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'super')).toBe(true);
    expect(abilityEvents(evts)).toHaveLength(0);
  });
});

describe('match simulation logs ability triggers', () => {
  it('runs both bundled transcripts to a finish with abilities from both fighters', () => {
    for (const file of ['microservices.json', 'tabs-vs-spaces.json']) {
      const t = transcript(file);
      const result = simulateTranscript(t, { p1Name: t.p1, p2Name: t.p2 });
      expect(result.matchOver, `${file} finished`).toBe(true);
      expect(result.events.some((e) => e.type === 'matchEnd'), `${file} matchEnd`).toBe(true);
      const fired = abilityEvents(result.events);
      expect(fired.length, `${file} ability events`).toBeGreaterThan(0);
      expect(new Set(fired.map((e) => e.owner)).size, `${file} ability owners`).toBeGreaterThanOrEqual(2);
      expect(new Set(fired.map((e) => e.effect)).size, `${file} effect kinds`).toBeGreaterThanOrEqual(2);
    }
  });
});
