import { describe, it, expect } from 'vitest';
import { FightEngine } from '../src/engine/match';
import type { CombatEvent } from '../src/engine/types';

describe('FightEngine', () => {
  it('emits combat events for a completed turn', () => {
    const seen: CombatEvent[] = [];
    const e = new FightEngine('p1');
    e.on((ev) => seen.push(ev));
    e.setPlayerAction('GUARD');
    e.completeTurn('p2', 'Latency dropped 43% across 2000 requests.');
    expect(seen.some((s) => s.type === 'attack')).toBe(true);
    expect(seen.some((s) => s.type === 'blocked' || s.type === 'hit')).toBe(true);
  });

  it('clears the chosen action after each turn so it must be re-picked', () => {
    const e = new FightEngine('p1');
    e.setPlayerAction('GUARD');
    e.completeTurn('p2', 'A short jab.');
    expect(e.playerAction).toBe('NONE');
  });

  it('feeds the analyzer each speaker their own history, detecting a loop', () => {
    const seen: CombatEvent[] = [];
    const e = new FightEngine('p1');
    e.on((ev) => seen.push(ev));
    const line = 'Kubernetes adds operational overhead for very small teams.';
    e.completeTurn('p2', line);
    e.completeTurn('p1', 'Managed control planes remove most of that overhead entirely.');
    e.completeTurn('p2', line);
    const attacks = seen.filter(
      (s): s is Extract<CombatEvent, { type: 'attack' }> => s.type === 'attack'
    );
    expect(attacks[2]?.kind).toBe('SELF_HIT');
  });

  it('awards a round and resets credibility on KO', () => {
    const e = new FightEngine('p1');
    e.state.p1.credibility = 3;
    e.completeTurn('p2', 'x '.repeat(120));
    expect(e.state.p2.roundsWon).toBe(1);
    expect(e.state.p1.credibility).toBe(100);
    expect(e.state.round).toBe(2);
  });

  it('ends the match after two round wins', () => {
    const e = new FightEngine('p1');
    e.state.p2.roundsWon = 1;
    e.state.p1.credibility = 3;
    e.completeTurn('p2', 'x '.repeat(120));
    expect(e.matchOver).toBe(true);
  });

  it('ignores turns once the match is over', () => {
    const e = new FightEngine('p1');
    e.state.p2.roundsWon = 1;
    e.state.p1.credibility = 3;
    e.completeTurn('p2', 'x '.repeat(120));
    const after = e.state.p1.credibility;
    e.completeTurn('p2', 'x '.repeat(120));
    expect(e.state.p1.credibility).toBe(after);
  });

  it('awards a timed-out round to whoever has more credibility', () => {
    const e = new FightEngine('p1');
    e.state.p1.credibility = 70;
    e.state.p2.credibility = 40;
    e.endRoundOnTime();
    expect(e.state.p1.roundsWon).toBe(1);
    expect(e.state.round).toBe(2);
  });
});
