import { describe, it, expect } from 'vitest';
import { SpectateReducer } from '../src/sources/spectate';
import type { SessionSnapshot } from '../src/server/session';
import type { StreamHandlers } from '../src/sources/types';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    type: 'turn',
    topic: 'T',
    names: { p1: 'CLAUDE', p2: 'CODEX' },
    nextSpeaker: 'p2',
    matchOver: false,
    credibility: { p1: 100, p2: 100 },
    round: 1,
    turns: [],
    events: [],
    ...overrides
  };
}

describe('SpectateReducer', () => {
  it('a "thinking" snapshot opens the wind-up and does not resolve a turn', () => {
    const calls: string[] = [];
    const handlers: StreamHandlers = {
      onTurnStart: (s) => calls.push(`start:${s}`),
      onTurnChunk: () => calls.push('chunk'),
      onTurnEnd: () => calls.push('end')
    };
    const reducer = new SpectateReducer();
    const resolved = reducer.apply(
      snapshot({ type: 'thinking', nextSpeaker: 'p1', turns: [], events: [] }),
      handlers
    );
    expect(resolved).toBe(false);
    expect(calls).toEqual(['start:p1']);
  });

  it('holds the wind-up open across an arbitrarily long gap: no onTurnStart repeats, no timeout, until "turn" arrives', () => {
    const calls: string[] = [];
    const handlers: StreamHandlers = {
      onTurnStart: (s) => calls.push(`start:${s}`),
      onTurnChunk: () => calls.push('chunk'),
      onTurnEnd: () => calls.push('end')
    };
    const reducer = new SpectateReducer();
    reducer.apply(snapshot({ type: 'thinking', nextSpeaker: 'p1' }), handlers);
    const resolved = reducer.apply(
      snapshot({ type: 'turn', turns: [{ speaker: 'p1', text: 'A real argument.' }] }),
      handlers
    );
    expect(resolved).toBe(true);
    expect(calls).toEqual(['start:p1', 'chunk', 'end']);
  });

  it('falls back to onTurnStart from a "turn" snapshot alone when no "thinking" ever arrived for that speaker', () => {
    const calls: string[] = [];
    const handlers: StreamHandlers = {
      onTurnStart: (s) => calls.push(`start:${s}`),
      onTurnChunk: () => calls.push('chunk'),
      onTurnEnd: () => calls.push('end')
    };
    const reducer = new SpectateReducer();
    const resolved = reducer.apply(
      snapshot({ type: 'turn', turns: [{ speaker: 'p2', text: 'A reply.' }] }),
      handlers
    );
    expect(resolved).toBe(true);
    expect(calls).toEqual(['start:p2', 'chunk', 'end']);
  });

  it('relays server-authoritative credibility/round/matchOver/events via onServerSnapshot, never computing them itself', () => {
    const received: unknown[] = [];
    const handlers: StreamHandlers = {
      onTurnStart: () => {},
      onTurnChunk: () => {},
      onTurnEnd: () => {},
      onServerSnapshot: (s) => received.push(s)
    };
    const reducer = new SpectateReducer();
    reducer.apply(
      snapshot({
        type: 'turn',
        turns: [{ speaker: 'p1', text: 'x' }],
        credibility: { p1: 62, p2: 100 },
        round: 2,
        matchOver: true,
        events: [{ type: 'ko', loser: 'p2' }]
      }),
      handlers
    );
    expect(received).toEqual([
      { credibility: { p1: 62, p2: 100 }, round: 2, matchOver: true, events: [{ type: 'ko', loser: 'p2' }] }
    ]);
  });
});
