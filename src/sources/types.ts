/**
 * A match source feeds the engine one streamed message at a time.
 *
 * `ReplaySource` (bundled transcripts), `LiveSource` (real models over SSE), and
 * `SpectateSource` (a read-only mirror of a remote match, via the optional
 * `onServerSnapshot` hook below) all implement this identically, so neither the
 * engine nor the renderer can tell which one is driving the fight.
 */

import type { CombatEvent, Speaker } from '../engine/types';

export interface Transcript {
  topic: string;
  p1: string;
  p2: string;
  turns: { speaker: Speaker; text: string }[];
}

export interface StreamHandlers {
  /** The fighter starts composing — begin the wind-up, open the action window. */
  onTurnStart(speaker: Speaker): void;
  /** More tokens arrived — grow the charge, update the fighter's screen. */
  onTurnChunk(speaker: Speaker, textSoFar: string): void;
  /** The message is complete — this is the moment the move lands. */
  onTurnEnd(speaker: Speaker, fullText: string): void;
  /**
   * Optional: a spectate-only extension point. Fired with the server's
   * authoritative round/credibility/matchOver state and this turn's combat
   * events, so a spectator can mirror the fight without recomputing any of the
   * engine's own rules. `replay.ts` and `live.ts` never call this — every
   * existing source's behavior is unchanged.
   */
  onServerSnapshot?(snapshot: {
    credibility: { p1: number; p2: number };
    round: number;
    matchOver: boolean;
    events: CombatEvent[];
  }): void;
}

export interface MatchSource {
  readonly topic: string;
  readonly names: { p1: string; p2: string };
  /** Streams one turn. Resolves false when the source has no more turns. */
  nextTurn(handlers: StreamHandlers): Promise<boolean>;
  /** Rewind to the first turn (used between rounds). */
  reset(): void;
  stop(): void;
}
