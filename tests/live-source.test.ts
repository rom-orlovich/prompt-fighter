import { describe, it, expect } from 'vitest';
import { createLiveSource } from '../src/sources/live';
import { createLocalBrain } from '../src/brains/local';
import type { Speaker } from '../src/engine/types';
import type { StreamHandlers } from '../src/sources/types';

const names = { p1: 'CLAUDE', p2: 'CODEX' };

function brains() {
  return { p1: createLocalBrain(), p2: createLocalBrain() };
}

function recordingHandlers() {
  const starts: Speaker[] = [];
  const ends: { speaker: Speaker; text: string }[] = [];
  const handlers: StreamHandlers = {
    onTurnStart: (s) => starts.push(s),
    onTurnChunk: () => {},
    onTurnEnd: (s, text) => ends.push({ speaker: s, text })
  };
  return { handlers, starts, ends };
}

describe('createLiveSource', () => {
  it('implements the same MatchSource contract replay.ts does: topic and names are exposed', () => {
    const source = createLiveSource('TOPIC', names, brains());
    expect(source.topic).toBe('TOPIC');
    expect(source.names).toEqual(names);
  });

  it('alternates speakers starting with p1, exactly like simulate.ts and server/session.ts', async () => {
    const source = createLiveSource('TOPIC', names, brains());
    const { handlers, ends } = recordingHandlers();
    for (let i = 0; i < 4; i++) await source.nextTurn(handlers);
    expect(ends.map((e) => e.speaker)).toEqual(['p1', 'p2', 'p1', 'p2']);
  });

  it('emits onTurnStart before onTurnChunk/onTurnEnd for the same speaker', async () => {
    const source = createLiveSource('TOPIC', names, brains());
    const { handlers, starts, ends } = recordingHandlers();
    await source.nextTurn(handlers);
    expect(starts).toEqual([ends[0].speaker]);
  });

  it('stop() halts further turns', async () => {
    const source = createLiveSource('TOPIC', names, brains());
    const { handlers } = recordingHandlers();
    source.stop();
    const more = await source.nextTurn(handlers);
    expect(more).toBe(false);
  });

  it('reset() rewinds turn order back to p1 and clears history', async () => {
    const source = createLiveSource('TOPIC', names, brains());
    const { handlers, ends } = recordingHandlers();
    await source.nextTurn(handlers); // p1
    await source.nextTurn(handlers); // p2
    source.reset();
    await source.nextTurn(handlers); // should be p1 again
    expect(ends[2].speaker).toBe('p1');
  });
});
