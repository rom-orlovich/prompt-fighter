/**
 * Headless whole-transcript simulator: feeds a bundled `Transcript` through a
 * `FightEngine` turn by turn with no rendering, no timers and no player input,
 * and returns every event it emitted plus the final state. Used by tests and by
 * any tooling that wants to know how a fight plays out without a browser.
 *
 * Deterministic: a given transcript always produces the same events, since
 * nothing in the engine (analyzer, combat, abilities) uses randomness.
 */

import { FightEngine } from './match';
import type { CombatEvent, MatchState, Speaker } from './types';
import type { Transcript } from '../sources/types';

export interface SimulateOptions {
  /** Which fighter the (nonexistent, headless) player would be coaching — only
   * matters for which side of `combat.ts`'s two stance-switches applies each
   * turn. Defaults to 'p1'. */
  playerSide?: Speaker;
  p1Name?: string;
  p2Name?: string;
  /** Safety valve: if the transcript runs out before two rounds are decided, the
   * turns are replayed from the start (the argument keeps going) — capped in
   * total turns processed so a pathological transcript can never spin forever. */
  maxTurns?: number;
}

export interface SimulateResult {
  events: CombatEvent[];
  state: MatchState;
  matchOver: boolean;
}

/** Generous multiple of a transcript's own length — real bundled transcripts
 * decide the match within one or two passes; this only guards against a
 * pathologically short or balanced one spinning forever. */
const DEFAULT_MAX_TURN_MULTIPLE = 20;

export function simulateTranscript(transcript: Transcript, options: SimulateOptions = {}): SimulateResult {
  // An empty transcript is malformed input, not a match: there is nothing to
  // simulate. Without this guard `maxTurns` computed to 0, the turn loop was
  // skipped, and the timeout-guard loop ran its full 10 rounds without ever
  // deciding a winner — returning a non-terminal `matchOver: false` result (a
  // fight that "ended" with nothing having happened) instead of failing fast.
  if (transcript.turns.length === 0) {
    throw new Error('cannot simulate an empty transcript (zero turns)');
  }

  const playerSide = options.playerSide ?? 'p1';
  const p1Name = options.p1Name ?? transcript.p1;
  const p2Name = options.p2Name ?? transcript.p2;
  const maxTurns = options.maxTurns ?? transcript.turns.length * DEFAULT_MAX_TURN_MULTIPLE;

  const engine = new FightEngine(playerSide, p1Name, p2Name);
  const events: CombatEvent[] = [];
  engine.on((event) => events.push(event));

  // Real bundled transcripts decide the match well within one pass, but a short
  // or unusually balanced one might not — the argument simply keeps going,
  // cycling back to the start of the transcript, deterministically (no RNG),
  // until two rounds are won. `maxTurns` bounds this in case of a genuine
  // deadlock (e.g. a transcript too short to ever land a KO or a timeout tie).
  for (let i = 0; i < maxTurns && !engine.matchOver; i++) {
    const turn = transcript.turns[i % transcript.turns.length];
    engine.completeTurn(turn.speaker, turn.text);
  }

  // Last resort for a transcript that can never resolve on its own (e.g. it has
  // zero turns, or every round times out tied): timing out the round awards it
  // to whoever currently holds more credibility, which is enough to eventually
  // break a tie once one fighter's shield/heal abilities create any asymmetry.
  let timeoutGuard = 0;
  while (!engine.matchOver && timeoutGuard < 10) {
    engine.endRoundOnTime();
    timeoutGuard += 1;
  }

  return { events, state: engine.state, matchOver: engine.matchOver };
}
