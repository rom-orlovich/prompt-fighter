/**
 * `simulateTranscript`'s termination contract. The engine can spin its round
 * timeout guard forever on a transcript with nothing to fight over, so the one
 * case that has no valid outcome — a transcript with zero turns — must fail fast
 * with an explicit error instead of returning a non-terminal `matchOver: false`.
 */

import { describe, it, expect } from 'vitest';
import { simulateTranscript } from '../src/engine/simulate';
import type { Transcript } from '../src/sources/types';

const base = { topic: 'TEST', p1: 'CLAUDE', p2: 'CODEX' };

describe('simulateTranscript', () => {
  it('rejects a zero-turn transcript with an explicit error, not a hung run', () => {
    const empty: Transcript = { ...base, turns: [] };
    expect(() => simulateTranscript(empty)).toThrow(/empty transcript/i);
  });

  it('terminates and produces events on a real (non-empty) transcript', () => {
    const t: Transcript = {
      ...base,
      turns: [
        { speaker: 'p1', text: 'Latency dropped 43% over 2000 requests, so this settles it.' },
        { speaker: 'p2', text: "That's just wrong — you're ignoring the tail latency entirely." },
        { speaker: 'p1', text: 'No. That is a scaling myth.' },
        { speaker: 'p2', text: 'I agree, but the core claim still holds under load.' }
      ]
    };
    const result = simulateTranscript(t);
    // The point is that it RETURNS (bounded, never hangs) with a well-formed,
    // decided result — not the non-terminal matchOver:false the empty case gave.
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.matchOver).toBe(true);
  });
});
