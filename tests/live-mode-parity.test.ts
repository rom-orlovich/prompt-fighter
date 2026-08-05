/**
 * Requirement (c) from worker-live-mode.txt: prove the CLI and server drivers reuse
 * the engine rather than reimplementing it. Both tests feed the exact same turn text
 * into a raw `FightEngine.completeTurn()` and into the live-mode path, and assert the
 * resulting `CombatEvent[]` are exactly equal — since the engine is deterministic
 * (no RNG, no Date), any divergence in either driver would fail this immediately.
 */

import { describe, it, expect } from 'vitest';
import { FightEngine } from '../src/engine/match';
import type { CombatEvent, Speaker } from '../src/engine/types';
import { createLiveSource } from '../src/sources/live';
import { createLocalBrain } from '../src/brains/local';
import { runLiveMatch } from '../src/cli/runner';
import { MatchSession } from '../src/server/session';

const P1_NAME = 'CLAUDE';
const P2_NAME = 'CODEX';

describe('CLI path never diverges from the engine', () => {
  it('replaying the exact turns runLiveMatch fed to the engine produces identical events', async () => {
    const engineA = new FightEngine('p1', P1_NAME, P2_NAME);
    const eventsA: CombatEvent[] = [];
    engineA.on((e) => eventsA.push(e));

    const pairs: { speaker: Speaker; text: string }[] = [];
    const source = createLiveSource(
      'TEST TOPIC',
      { p1: P1_NAME, p2: P2_NAME },
      { p1: createLocalBrain(), p2: createLocalBrain() }
    );

    await runLiveMatch(engineA, source, {
      onTurnStart: (speaker, text) => pairs.push({ speaker, text })
    });
    expect(engineA.matchOver).toBe(true); // decided by real turns, not the timeout guard

    const engineB = new FightEngine('p1', P1_NAME, P2_NAME);
    const eventsB: CombatEvent[] = [];
    engineB.on((e) => eventsB.push(e));
    for (const { speaker, text } of pairs) {
      if (engineB.matchOver) break;
      engineB.completeTurn(speaker, text);
    }

    expect(eventsB).toEqual(eventsA);
  });
});

describe('server session never diverges from the engine', () => {
  it('MatchSession.submitTurn returns exactly what engine.completeTurn returns for the same call', () => {
    const session = new MatchSession({ p1Name: P1_NAME, p2Name: P2_NAME });
    const rawEngine = new FightEngine('p1', P1_NAME, P2_NAME);
    const rawEvents: CombatEvent[] = [];
    rawEngine.on((e) => rawEvents.push(e));

    const text = 'A 2024 benchmark measured a 43% swing across 2,000 trials.';
    const sessionEvents = session.submitTurn('p1', text);
    rawEngine.completeTurn('p1', text);

    expect(sessionEvents).toEqual(rawEvents);
  });

  it('stays identical across a full multi-turn exchange, including a round boundary', () => {
    const session = new MatchSession({ p1Name: P1_NAME, p2Name: P2_NAME });
    const rawEngine = new FightEngine('p1', P1_NAME, P2_NAME);

    const script: { speaker: Speaker; text: string }[] = [
      { speaker: 'p1', text: 'Short jab.' },
      { speaker: 'p2', text: 'x '.repeat(120) }, // forces a KO -> roundEnd
      { speaker: 'p1', text: 'Maybe, though it depends, I am not sure that generalizes.' },
      { speaker: 'p2', text: 'A cited stat: 43% across 2,000 trials.' }
    ];

    for (const { speaker, text } of script) {
      const sessionEvents = session.matchOver ? null : session.submitTurn(speaker, text);
      const rawEvents = rawEngine.matchOver ? [] : rawEngine.completeTurn(speaker, text);
      if (sessionEvents !== null) expect(sessionEvents).toEqual(rawEvents);
    }
  });
});
