/**
 * Live match source: drives two `FighterBrain`s through the exact same `MatchSource`
 * seam `replay.ts` implements. `sources/types.ts`'s own doc comment names this file
 * ("a future `LiveSource` (real models over SSE)") and promises the engine and
 * renderer can't tell it apart from replay — this keeps that promise by emitting the
 * identical `onTurnStart` / `onTurnChunk` / `onTurnEnd` sequence, just sourced from a
 * brain's answer instead of a bundled transcript.
 *
 * Turn order alternates p1/p2 starting with p1, mirroring `simulate.ts`'s driving
 * loop and `server/session.ts`'s authoritative turn tracking — all three pick the
 * next speaker the same way so nothing downstream has to special-case which one is
 * driving a given match.
 */

import type { FighterBrain, BrainContext } from '../brains/types';
import type { Speaker } from '../engine/types';
import type { MatchSource, StreamHandlers } from './types';

export interface LiveSourceOptions {
  /** Per-word chunk delay in ms, mirroring `replay.ts`'s streaming cadence. `0` (the
   * CLI default) emits the whole message in one chunk — there is nothing to wait on
   * when the "stream" is really a brain's already-complete answer. */
  chunkMs?: number;
}

const other = (s: Speaker): Speaker => (s === 'p1' ? 'p2' : 'p1');

export function createLiveSource(
  topic: string,
  names: { p1: string; p2: string },
  brains: Record<Speaker, FighterBrain>,
  options: LiveSourceOptions = {}
): MatchSource {
  const chunkMs = options.chunkMs ?? 0;
  let turnIndex = 0;
  let nextSpeaker: Speaker = 'p1';
  let stopped = false;
  const lastText: Record<Speaker, string | undefined> = { p1: undefined, p2: undefined };

  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

  return {
    topic,
    names,

    async nextTurn(handlers: StreamHandlers): Promise<boolean> {
      if (stopped) return false;
      const speaker = nextSpeaker;
      const opponent = other(speaker);

      const ctx: BrainContext = {
        speaker,
        opponent,
        names,
        topic,
        turnIndex,
        lastOpponentText: lastText[opponent],
        lastOwnText: lastText[speaker]
      };

      handlers.onTurnStart(speaker);
      const text = await brains[speaker].nextMessage(ctx);
      if (stopped) return false;

      let shown = '';
      const words = text.split(' ');
      for (const word of words) {
        shown = shown ? `${shown} ${word}` : word;
        handlers.onTurnChunk(speaker, shown);
        if (chunkMs > 0) {
          await sleep(chunkMs);
          if (stopped) return false;
        }
      }

      handlers.onTurnEnd(speaker, text);
      lastText[speaker] = text;
      nextSpeaker = opponent;
      turnIndex += 1;
      return !stopped;
    },

    reset() {
      turnIndex = 0;
      nextSpeaker = 'p1';
      lastText.p1 = undefined;
      lastText.p2 = undefined;
    },

    stop() {
      stopped = true;
    }
  };
}
