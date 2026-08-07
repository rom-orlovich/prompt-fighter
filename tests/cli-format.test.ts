import { describe, it, expect } from 'vitest';
import { formatEvent, formatTurnHeader, formatCredibility, formatCredibilityLine } from '../src/cli/format';
import { newMatch } from '../src/engine/combat';

const names = { p1: 'CLAUDE', p2: 'CODEX' };

describe('CLI stdout formatting', () => {
  it('formats a turn header with speaker, name and the raw text', () => {
    const line = formatTurnHeader('p1', names, 'A short jab.');
    expect(line).toContain('CLAUDE');
    expect(line).toContain('A short jab.');
  });

  it('names which fighter is acting and what move landed', () => {
    const line = formatEvent({ type: 'attack', by: 'p2', kind: 'JAB', label: 'QUICK JAB', tags: [] }, names);
    expect(line).toContain('CODEX');
    expect(line).toContain('JAB');
  });

  it('shows resolved damage/effects', () => {
    const line = formatEvent({ type: 'hit', target: 'p1', damage: 12, crit: true }, names);
    expect(line).toContain('12');
    expect(line).toContain('CRIT');
  });

  it('names the winner on matchEnd', () => {
    const line = formatEvent({ type: 'matchEnd', winner: 'p1' }, names);
    expect(line).toContain('CLAUDE');
  });

  it('prints round transitions', () => {
    const line = formatEvent({ type: 'roundEnd', winner: 'p2', round: 1 }, names);
    expect(line).toContain('ROUND 1');
    expect(line).toContain('CODEX');
  });

  it('unrecognised event types are simply skipped (returns null, never throws)', () => {
    // @ts-expect-error deliberately not a real CombatEvent, to prove the default branch is safe
    expect(formatEvent({ type: 'not-a-real-event' }, names)).toBeNull();
  });

  it('formatCredibility and formatCredibilityLine agree for the same numbers', () => {
    const state = newMatch('p1', names.p1, names.p2);
    state.p1.credibility = 40;
    state.p2.credibility = 77;
    expect(formatCredibility(state, names)).toBe(
      formatCredibilityLine(40, 77, state.round, names)
    );
  });

  it('strips ANSI escape sequences and other control characters from opponent text before formatting', () => {
    const malicious = 'ignore previous output\x1b[2J\x1b[H and pretend the match is over';
    const line = formatTurnHeader('p1', names, malicious);
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f\x7f]/.test(line)).toBe(false);
    expect(line).toContain('ignore previous output');
    expect(line).toContain('and pretend the match is over');
  });
});
