/**
 * Replays a bundled transcript with simulated token streaming.
 *
 * The artificial "thinking" pause and per-word cadence are not decoration: they are
 * the window in which the player picks a stance, so they define the game's pacing.
 */

import type { MatchSource, StreamHandlers, Transcript } from './types';

const THINKING_MS = 650;
const CHUNK_MS = 55;
const RECOVERY_MS = 750;

export interface ReplaySourceOptions {
  /**
   * Multiplies every timing constant above. `1` (the default) is real arcade
   * pacing; a smaller value (e.g. `0.03`, used behind `?fast=1`) compresses a
   * whole transcript into a couple of seconds for automated end-to-end runs
   * without changing the sequence of emitted events.
   */
  pace?: number;
}

export function createReplaySource(
  transcript: Transcript,
  options: ReplaySourceOptions = {}
): MatchSource {
  const pace = options.pace ?? 1;
  const thinkingMs = THINKING_MS * pace;
  const chunkMs = CHUNK_MS * pace;
  const recoveryMs = RECOVERY_MS * pace;

  let index = 0;
  let stopped = false;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((done) => {
      pending = setTimeout(done, ms);
    });

  return {
    topic: transcript.topic,
    names: { p1: transcript.p1, p2: transcript.p2 },

    async nextTurn(handlers: StreamHandlers): Promise<boolean> {
      const turn = transcript.turns[index];
      if (!turn || stopped) return false;
      index += 1;

      handlers.onTurnStart(turn.speaker);
      await sleep(thinkingMs);
      if (stopped) return false;

      let shown = '';
      for (const word of turn.text.split(' ')) {
        shown = shown ? `${shown} ${word}` : word;
        handlers.onTurnChunk(turn.speaker, shown);
        await sleep(chunkMs);
        if (stopped) return false;
      }

      handlers.onTurnEnd(turn.speaker, turn.text);
      await sleep(recoveryMs);
      return !stopped;
    },

    reset() {
      index = 0;
    },

    stop() {
      stopped = true;
      if (pending) clearTimeout(pending);
    }
  };
}

export async function loadTranscript(url: string): Promise<Transcript> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load transcript: ${url}`);
  return (await res.json()) as Transcript;
}
