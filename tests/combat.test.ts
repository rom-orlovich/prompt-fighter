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

  // Design spec §2: `"I agree, but…"` maps to `PARRY` -> `COUNTER`. Before this,
  // a PARRY fell through every branch and resolved as an ordinary hit.
  describe('PARRY -> COUNTER', () => {
    const parry = (over = {}) => intent({ kind: 'PARRY', power: 9, label: 'YES, BUT', ...over });

    it('resolves as a counter, not as a plain hit', () => {
      const s = newMatch();
      const evts = resolve({ attacker: 'p2', intent: parry(), playerAction: 'NONE', state: s });
      expect(evts.some((e) => e.type === 'counter' && e.by === 'p2')).toBe(true);
      // The counter *replaces* the hit — the blow must never be paid out twice.
      expect(damageTo(evts, 'p1')).toBe(0);
      expect(s.p1.credibility).toBeLessThan(100);
    });

    it('hits harder than the same move would as a plain hit', () => {
      const parried = newMatch();
      resolve({ attacker: 'p2', intent: parry(), playerAction: 'NONE', state: parried });
      const plain = newMatch();
      resolve({ attacker: 'p2', intent: intent({ kind: 'STRIKE', power: 9 }), playerAction: 'NONE', state: plain });
      expect(parried.p1.credibility).toBeLessThan(plain.p1.credibility);
    });

    it('deflects the opponent momentum it just conceded to', () => {
      const s = newMatch();
      // p1 has a combo going; p2 answers "I agree, but…" and it dies on the concession.
      s.p1.combo = 3;
      const evts = resolve({ attacker: 'p2', intent: parry(), playerAction: 'NONE', state: s });
      expect(s.p1.combo).toBe(0);
      expect(evts.some((e) => e.type === 'comboBreak' && e.by === 'p1')).toBe(true);
    });

    it('can land the KO itself', () => {
      const s = newMatch();
      s.p1.credibility = 3;
      const evts = resolve({ attacker: 'p2', intent: parry(), playerAction: 'NONE', state: s });
      expect(evts.some((e) => e.type === 'ko' && e.loser === 'p1')).toBe(true);
      expect(s.p1.credibility).toBe(0);
    });

    it('stays a super rather than also converting to a counter', () => {
      // A super sits above the rock-paper-scissors layer, as it does for every
      // other stance win here: one strike resolves once. Converting it as well
      // double-resolved the same blow and ended matches on the super beat.
      const s = newMatch();
      s.p2.meter = 100;
      const evts = resolve({ attacker: 'p2', intent: parry(), playerAction: 'NONE', state: s });
      expect(evts.some((e) => e.type === 'super')).toBe(true);
      expect(evts.some((e) => e.type === 'counter')).toBe(false);
      expect(s.p1.credibility).toBeLessThan(100);
    });

    it('still yields to the defender own counter-stance', () => {
      // A hedging PARRY walking into FACT_STRIKE is punished as the hedge it is —
      // the defender's counter wins, and the parry never converts.
      const s = newMatch();
      const evts = resolve({
        attacker: 'p2',
        intent: parry({ tags: ['hedge'] }),
        playerAction: 'FACT_STRIKE',
        state: s
      });
      expect(evts.some((e) => e.type === 'counter' && e.by === 'p1')).toBe(true);
      expect(evts.some((e) => e.type === 'counter' && e.by === 'p2')).toBe(false);
      expect(s.p1.credibility).toBe(100);
    });
  });

  // Design spec §3 rock-paper-scissors core: `Pivot > Undercut`. Before this,
  // UNDERCUT existed only as a player action, so the rule was unreachable.
  describe('PIVOT beats an incoming UNDERCUT', () => {
    const undercut = (over = {}) =>
      intent({ kind: 'UNDERCUT', power: 11, label: 'FOUND THE FLAW', ...over });

    it('evades it outright — no damage at all', () => {
      const s = newMatch();
      const evts = resolve({ attacker: 'p2', intent: undercut(), playerAction: 'PIVOT', state: s });
      expect(s.p1.credibility).toBe(100);
      expect(damageTo(evts, 'p1')).toBe(0);
      expect(evts.some((e) => e.type === 'whiff' && e.by === 'p2')).toBe(true);
    });

    it('breaks the undercutter combo', () => {
      const s = newMatch();
      s.p2.combo = 4;
      resolve({ attacker: 'p2', intent: undercut({ continuesThread: false }), playerAction: 'PIVOT', state: s });
      expect(s.p2.combo).toBe(0);
    });

    it('emits a comboBreak on the undercutter so the pivot plays a visible dodge', () => {
      // `main.ts` drives the defender's dodge animation off `comboBreak`, never off
      // a bare `whiff` — so when the undercutter has a live chain, the evade must
      // fire the comboBreak (by the attacker whose chain just died) too, mirroring
      // the PARRY -> COUNTER branch. A thread-continuing UNDERCUT builds combo to 1
      // this turn, which the pivot then breaks.
      const s = newMatch();
      const evts = resolve({
        attacker: 'p2',
        intent: undercut({ continuesThread: true }),
        playerAction: 'PIVOT',
        state: s
      });
      expect(evts.some((e) => e.type === 'comboBreak' && e.by === 'p2')).toBe(true);
      expect(evts.some((e) => e.type === 'whiff' && e.by === 'p2')).toBe(true);
      expect(s.p2.combo).toBe(0);
    });

    it('with no active prior combo, still emits a comboBreak on the undercutter so the pivot visibly dodges', () => {
      // Distinct from the case above: here the undercutter has no live combo
      // going in (fresh match) *and* the intent does not continue a thread, so
      // `atk.combo` never leaves 0. The pivot still evades outright and the
      // dodge reaction must still play — `main.ts`'s comboBreak handler never
      // gates on combo count, so the event must fire regardless of whether
      // there was anything to actually break.
      const s = newMatch();
      expect(s.p2.combo).toBe(0);
      const evts = resolve({
        attacker: 'p2',
        intent: undercut({ continuesThread: false }),
        playerAction: 'PIVOT',
        state: s
      });
      expect(evts.some((e) => e.type === 'comboBreak' && e.by === 'p2')).toBe(true);
      expect(evts.some((e) => e.type === 'whiff' && e.by === 'p2')).toBe(true);
      expect(s.p2.combo).toBe(0);
      expect(damageTo(evts, 'p1')).toBe(0);
    });

    it('is strictly better than pivoting into anything else', () => {
      const vsUndercut = newMatch();
      resolve({ attacker: 'p2', intent: undercut(), playerAction: 'PIVOT', state: vsUndercut });
      const vsStrike = newMatch();
      resolve({ attacker: 'p2', intent: intent({ kind: 'STRIKE', power: 11 }), playerAction: 'PIVOT', state: vsStrike });
      expect(vsStrike.p1.credibility).toBeLessThan(vsUndercut.p1.credibility);
      expect(vsUndercut.p1.credibility).toBe(100);
    });

    it('does not evade a super', () => {
      const s = newMatch();
      s.p2.meter = 100;
      const evts = resolve({ attacker: 'p2', intent: undercut(), playerAction: 'PIVOT', state: s });
      expect(evts.some((e) => e.type === 'super')).toBe(true);
      expect(s.p1.credibility).toBeLessThan(100);
    });

    it('leaves every other stance reduced-but-landing against an UNDERCUT', () => {
      // Only PIVOT beats it — GUARD still eats chip damage, NONE eats it clean.
      for (const action of ['GUARD', 'NONE'] as const) {
        const s = newMatch();
        resolve({ attacker: 'p2', intent: undercut(), playerAction: action, state: s });
        expect(s.p1.credibility, `${action} should still take damage`).toBeLessThan(100);
      }
    });
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

  it('runs end-to-end from raw text as a PARRY that counters', () => {
    const s = newMatch();
    const evts = resolve({
      attacker: 'p2',
      intent: analyze('I agree, but that only holds under low load.'),
      playerAction: 'NONE',
      state: s
    });
    expect(evts.some((e) => e.type === 'attack' && e.kind === 'PARRY')).toBe(true);
    expect(evts.some((e) => e.type === 'counter')).toBe(true);
    expect(s.p1.credibility).toBeLessThan(100);
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
