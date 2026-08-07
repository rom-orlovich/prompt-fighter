/**
 * Diagnostic report, not a pure unit test: proves PARRY is reachable in a full
 * local-vs-local match (mirrors `tests/brains.test.ts`'s PARRY regression test)
 * and console.logs a line containing both "PARRY" + "fires" and "reachable"
 * + "true", so `npm run test:reachability -- --grep PARRY` (the wf-simple
 * DoD's verify_how) has real matching text to grep.
 */
import { describe, it, expect } from 'vitest';
import { createLocalBrain } from '../src/brains/local';
import { createLiveSource } from '../src/sources/live';
import type { StreamHandlers } from '../src/sources/types';
import { analyze } from '../src/engine/analyzer';

const names = { p1: 'CLAUDE', p2: 'CODEX' };

describe('PARRY reachability report', () => {
  it('PARRY fires at least once across 10+ turns of a real local-vs-local match', async () => {
    const source = createLiveSource('TEST TOPIC', names, {
      p1: createLocalBrain(),
      p2: createLocalBrain()
    });
    const kinds: string[] = [];
    const handlers: StreamHandlers = {
      onTurnStart: () => {},
      onTurnChunk: () => {},
      onTurnEnd: (_s, text) => kinds.push(analyze(text).kind)
    };
    const TURNS = 22;
    for (let i = 0; i < TURNS; i++) await source.nextTurn(handlers);

    const parryCount = kinds.filter((k) => k === 'PARRY').length;
    const reachable = parryCount > 0;

    // eslint-disable-next-line no-console
    console.log(
      `PARRY fires ${parryCount} time(s) over ${TURNS} turns — reachable=${reachable}`
    );

    expect(reachable).toBe(true);
  });
});
