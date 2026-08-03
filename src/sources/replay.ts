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

export function createReplaySource(transcript: Transcript): MatchSource {
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
      await sleep(THINKING_MS);
      if (stopped) return false;

      let shown = '';
      for (const word of turn.text.split(' ')) {
        shown = shown ? `${shown} ${word}` : word;
        handlers.onTurnChunk(turn.speaker, shown);
        await sleep(CHUNK_MS);
        if (stopped) return false;
      }

      handlers.onTurnEnd(turn.speaker, turn.text);
      await sleep(RECOVERY_MS);
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
