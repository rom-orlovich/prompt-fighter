import { describe, it, expect } from 'vitest';
import { createLocalBrain } from '../src/brains/local';
import { createOpenRouterBrain } from '../src/brains/openrouter';
import { analyze } from '../src/engine/analyzer';
import type { BrainContext } from '../src/brains/types';

const names = { p1: 'CLAUDE', p2: 'CODEX' };

function ctx(overrides: Partial<BrainContext> = {}): BrainContext {
  return {
    speaker: 'p1',
    opponent: 'p2',
    names,
    topic: 'TEST TOPIC',
    turnIndex: 0,
    ...overrides
  };
}

describe('local brain', () => {
  it('needs no key and no network: same context always produces the same line', async () => {
    const brain = createLocalBrain();
    const a = await brain.nextMessage(ctx({ turnIndex: 3 }));
    const b = await brain.nextMessage(ctx({ turnIndex: 3 }));
    expect(a).toBe(b);
  });

  it('varies across the rotation as turnIndex advances', async () => {
    const brain = createLocalBrain();
    const lines = new Set<string>();
    for (let i = 0; i < 9; i++) {
      lines.add(await brain.nextMessage(ctx({ turnIndex: i })));
    }
    expect(lines.size).toBeGreaterThan(1);
  });

  it('reacts to the opponent last message: answers a trailing question with evidence', async () => {
    const brain = createLocalBrain();
    const reply = await brain.nextMessage(
      ctx({ turnIndex: 2, lastOpponentText: 'Why should anyone believe that?' })
    );
    expect(reply).toMatch(/\d+%/); // the evidence line always cites a stat
  });

  it('repeats its own last line on the loop slot, deterministically exercising SELF_HIT', async () => {
    const brain = createLocalBrain();
    // Slot 10 (0-indexed) in the 11-line rotation is the loop slot.
    const reply = await brain.nextMessage(ctx({ turnIndex: 10, lastOwnText: 'I said this already.' }));
    expect(reply).toBe('I said this already.');
  });

  it('emits a line the analyzer classifies as UNDERCUT, so PIVOT-beats-UNDERCUT is reachable', async () => {
    const brain = createLocalBrain();
    // Slot 9 (0-indexed) is the UNDERCUT slot. It must resolve to a real UNDERCUT
    // move, not fall through to some length branch — otherwise a normal player can
    // never see the pivot evade against the default local opponent.
    const reply = await brain.nextMessage(ctx({ turnIndex: 9 }));
    expect(analyze(reply).kind).toBe('UNDERCUT');
  });

  it('demo HEAVY/STRIKE slots classify as HEAVY/STRIKE, not a stray HONEST CORRECTION', async () => {
    const brain = createLocalBrain();
    // Both lines used to contain "actually", which the analyzer's self-correction
    // detector matched first, silently downgrading them to GUARD [HONEST CORRECTION]
    // and making the default demo unrepresentative of the move set it documents.
    expect(analyze(await brain.nextMessage(ctx({ turnIndex: 7 }))).kind).toBe('HEAVY');
    expect(analyze(await brain.nextMessage(ctx({ turnIndex: 8 }))).kind).toBe('STRIKE');
  });
});

describe('openrouter brain', () => {
  it('fails with a clear, actionable message when no key is set — never a stack trace, never a silent fallback', async () => {
    const brain = createOpenRouterBrain({ apiKey: undefined });
    await expect(brain.nextMessage(ctx())).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('is labeled by model so a done-marker can say exactly which brain ran', () => {
    const brain = createOpenRouterBrain({ apiKey: 'sk-test', model: 'anthropic/claude' });
    expect(brain.kind).toBe('openrouter:anthropic/claude');
  });
});
