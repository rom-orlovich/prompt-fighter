/**
 * A "fighter brain" produces one fighter's next message in a live match. It is the
 * one seam `LiveSource` (see `../sources/live.ts`) depends on, so swapping the brain
 * never touches the engine, the source contract, or the renderer.
 *
 * Two implementations exist behind this interface: `local.ts` (deterministic, no
 * network, no key — what makes live mode runnable and provable with zero setup) and
 * `openrouter.ts` (real models, requires `OPENROUTER_API_KEY`).
 */

import type { Speaker } from '../engine/types';

export interface BrainContext {
  speaker: Speaker;
  opponent: Speaker;
  names: { p1: string; p2: string };
  topic: string;
  /** 0-based count of turns already played by *either* fighter this match. */
  turnIndex: number;
  /** The opponent's most recent message, if any — the thing this turn is replying to. */
  lastOpponentText?: string;
  /** This fighter's own most recent message, if any — guards against repeating itself. */
  lastOwnText?: string;
}

export interface FighterBrain {
  /** Short id for logging/done-markers, e.g. "local" or "openrouter:openrouter/auto". */
  readonly kind: string;
  /** Produce this fighter's next full message for the given turn. */
  nextMessage(ctx: BrainContext): Promise<string>;
}
