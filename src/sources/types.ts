/**
 * A match source feeds the engine one streamed message at a time.
 *
 * `ReplaySource` (bundled transcripts) and a future `LiveSource` (real models over
 * SSE) implement this identically, so neither the engine nor the renderer can tell
 * which one is driving the fight.
 */

import type { Speaker } from '../engine/types';

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
