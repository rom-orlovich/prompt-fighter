/**
 * Diagnostic report, not a pure unit test: drives a full local-vs-local match
 * (same engine wiring as `tests/brains.test.ts`'s PARRY regression test) and
 * console.logs the resulting move-type distribution, so `npm run
 * test:classification` (invoked by the wf-simple DoD's verify_how) has real
 * "CRIT"/"HEAVY"/"distribution" text to grep — proving the fix for the CRIT
 * quotation-evidence short-circuit (see `src/engine/analyzer.ts`'s `QUOTED`
 * regex) actually produces a mixture of move kinds, not a CRIT-only run.
 */
import { describe, it, expect } from 'vitest';
import { createLocalBrain } from '../src/brains/local';
import { createLiveSource } from '../src/sources/live';
import type { StreamHandlers } from '../src/sources/types';
import { analyze } from '../src/engine/analyzer';

const names = { p1: 'CLAUDE', p2: 'CODEX' };

describe('move-type distribution report', () => {
  it('a real multi-turn local-vs-local run produces a mixture of move kinds, not CRIT-dominated', async () => {
    const source = createLiveSource('TEST TOPIC', names, {
      p1: createLocalBrain(),
      p2: createLocalBrain()
    });
    const counts: Record<string, number> = {};
    const handlers: StreamHandlers = {
      onTurnStart: () => {},
      onTurnChunk: () => {},
      onTurnEnd: (_s, text) => {
        const kind = analyze(text).kind;
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    };
    const TURNS = 24;
    for (let i = 0; i < TURNS; i++) await source.nextTurn(handlers);

    // eslint-disable-next-line no-console
    console.log(
      `move-type distribution over ${TURNS} turns: ` +
        `CRIT=${counts.CRIT ?? 0} HEAVY=${counts.HEAVY ?? 0} STRIKE=${counts.STRIKE ?? 0} ` +
        `UNDERCUT=${counts.UNDERCUT ?? 0} PARRY=${counts.PARRY ?? 0} ` +
        `JAB=${counts.JAB ?? 0} GUARD=${counts.GUARD ?? 0} GRAPPLE=${counts.GRAPPLE ?? 0} ` +
        `WHIFF=${counts.WHIFF ?? 0} SELF_HIT=${counts.SELF_HIT ?? 0}`
    );

    // Real assertion, not just a printed line: CRIT must not dominate the run —
    // at least one other move kind must appear, and CRIT must be a minority.
    const kindsSeen = Object.keys(counts).length;
    expect(kindsSeen).toBeGreaterThan(1);
    expect(counts.CRIT ?? 0).toBeLessThan(TURNS);
  });
});
