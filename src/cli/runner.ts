/**
 * Drives a `FightEngine` from a `MatchSource` with no human input, no browser and no
 * timers of its own — the CLI's counterpart to `engine/simulate.ts`, which does the
 * same thing for a bundled `Transcript`. Deliberately reuses `simulate.ts`'s exact
 * two-tier safety net (a generous turn cap, then a timeout-guard loop that forces
 * round decisions by credibility) rather than inventing a different one, per
 * `worker-live-mode.txt`'s explicit instruction to model this on `simulate.ts`.
 *
 * Every state change happens through `engine.completeTurn()` / `engine.endRoundOnTime()`
 * — the exact same calls `simulate.ts` and `server/session.ts` make — so this can never
 * resolve a turn differently than calling the engine directly would.
 */

import type { FightEngine } from '../engine/match';
import type { Speaker } from '../engine/types';
import type { MatchSource } from '../sources/types';

export interface LiveRunOptions {
  /** Safety valve, mirroring `simulate.ts`'s `maxTurns`: caps how many turns are
   * pulled from the source before falling back to the timeout guard. */
  maxTurns?: number;
  /** Fired once a turn's full text has landed, before it is resolved — the right
   * place to print "who is acting and what they said". */
  onTurnStart?: (speaker: Speaker, text: string) => void;
  /** Fired right after `engine.completeTurn()` resolves that turn — the right place
   * to print the resulting events and a credibility snapshot. */
  onTurnResolved?: (speaker: Speaker, text: string) => void;
}

/** Generous default: local brains cycle through a 10-line rotation and real
 * transcripts of similar shape decide a match well within this — see
 * `simulate.ts`'s `DEFAULT_MAX_TURN_MULTIPLE` for the same reasoning. */
const DEFAULT_MAX_TURNS = 80;
/** Same constant `simulate.ts` uses for its last-resort loop. */
const TIMEOUT_GUARD_ROUNDS = 10;

export async function runLiveMatch(
  engine: FightEngine,
  source: MatchSource,
  options: LiveRunOptions = {}
): Promise<void> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  for (let i = 0; i < maxTurns && !engine.matchOver; i++) {
    let speaker: Speaker | undefined;
    let text: string | undefined;

    const more = await source.nextTurn({
      onTurnStart: (s) => {
        speaker = s;
      },
      onTurnChunk: () => {},
      onTurnEnd: (s, full) => {
        speaker = s;
        text = full;
      }
    });
    if (!more || speaker === undefined || text === undefined) break;

    options.onTurnStart?.(speaker, text);
    engine.completeTurn(speaker, text);
    options.onTurnResolved?.(speaker, text);
  }

  // Last resort, identical strategy to simulate.ts: force round decisions by
  // whoever currently holds more credibility so a pathological match (e.g. a brain
  // whose lines never land a KO) can never spin forever.
  let guard = 0;
  while (!engine.matchOver && guard < TIMEOUT_GUARD_ROUNDS) {
    engine.endRoundOnTime();
    guard += 1;
  }
}
