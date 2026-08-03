import { describe, it, expect } from 'vitest';
import { resolve, newMatch } from '../src/engine/combat';
import { analyze } from '../src/engine/analyzer';
import type { CombatEvent, MoveIntent, Speaker } from '../src/engine/types';

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

const damageTo = (evts: CombatEvent[], target: Speaker) =>
  evts
    .filter((e): e is Extract<CombatEvent, { type: 'hit' }> => e.type === 'hit' && e.target === target)
    .reduce((n, e) => n + e.damage, 0);

describe('resolve', () => {
  it('damages the defender on a plain opponent attack', () => {
    const s = newMatch();
    const evts = resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: s });
    expect(damageTo(evts, 'p1')).toBeGreaterThan(0);
    expect(s.p1.credibility).toBeLessThan(100);
  });

  it('GUARD reduces incoming damage versus no action', () => {
    const guarded = newMatch();
    resolve({ attacker: 'p2', intent: intent(), playerAction: 'GUARD', state: guarded });
    const open = newMatch();
    resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: open });
    expect(guarded.p1.credibility).toBeGreaterThan(open.p1.credibility);
  });

  it('UNDERCUT fully counters a HEAVY attack', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ kind: 'HEAVY', power: 17 }),
      playerAction: 'UNDERCUT',
      state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(true);
    expect(s.p1.credibility).toBe(100);
    expect(s.p2.credibility).toBeLessThan(100);
  });

  it('UNDERCUT against a quick JAB does not counter', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ kind: 'JAB', power: 6 }),
      playerAction: 'UNDERCUT',
      state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(false);
    expect(s.p1.credibility).toBeLessThan(100);
  });

  it('FACT_STRIKE punishes an opponent who hedges', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ kind: 'GUARD', power: 3, tags: ['hedge'] }),
      playerAction: 'FACT_STRIKE',
      state: s
    });
    expect(evts.some((e) => e.type === 'counter')).toBe(true);
    expect(s.p2.credibility).toBeLessThan(100);
    expect(s.p1.credibility).toBe(100);
  });

  it('builds a combo when the attacker continues the thread', () => {
    const s = newMatch();
    resolve({ attacker: 'p2', intent: intent({ continuesThread: true }), playerAction: 'NONE', state: s });
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ continuesThread: true }),
      playerAction: 'NONE',
      state: s
    });
    expect(s.p2.combo).toBe(2);
    expect(evts.some((e) => e.type === 'combo')).toBe(true);
  });

  it('breaks the combo on a topic shift', () => {
    const s = newMatch();
    resolve({ attacker: 'p2', intent: intent({ continuesThread: true }), playerAction: 'NONE', state: s });
    const evts = resolve({
      attacker: 'p2',
      intent: intent({ continuesThread: false }),
      playerAction: 'NONE',
      state: s
    });
    expect(s.p2.combo).toBe(0);
    expect(evts.some((e) => e.type === 'comboBreak')).toBe(true);
  });

  it('applies self damage without hitting the opponent', () => {
    const s = newMatch();
    resolve({
      attacker: 'p2',
      intent: intent({ kind: 'SELF_HIT', power: 0, selfDamage: 9, meterGain: 0 }),
      playerAction: 'NONE',
      state: s
    });
    expect(s.p2.credibility).toBe(91);
    expect(s.p1.credibility).toBe(100);
  });

  it('fires a SUPER and spends the meter when it is full', () => {
    const s = newMatch();
    s.p2.meter = 100;
    const evts = resolve({ attacker: 'p2', intent: intent(), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'super')).toBe(true);
    expect(s.p2.meter).toBe(0);
  });

  it('emits a KO when credibility reaches zero', () => {
    const s = newMatch();
    s.p1.credibility = 4;
    const evts = resolve({ attacker: 'p2', intent: intent({ power: 40 }), playerAction: 'NONE', state: s });
    expect(evts.some((e) => e.type === 'ko')).toBe(true);
    expect(s.p1.credibility).toBe(0);
  });

  it('never lets credibility go negative', () => {
    const s = newMatch();
    s.p1.credibility = 2;
    resolve({ attacker: 'p2', intent: intent({ power: 99 }), playerAction: 'NONE', state: s });
    expect(s.p1.credibility).toBe(0);
  });

  it('runs end-to-end from raw text', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: analyze('Latency dropped 43% in production over 2000 requests.'),
      playerAction: 'NONE',
      state: s
    });
    expect(evts.some((e) => e.type === 'hit' && e.crit)).toBe(true);
  });
});
