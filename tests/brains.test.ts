import { describe, it, expect } from 'vitest';
import { createLocalBrain } from '../src/brains/local';
import { createOpenRouterBrain } from '../src/brains/openrouter';
import { analyze } from '../src/engine/analyzer';
import type { BrainContext } from '../src/brains/types';
import { createBrain } from '../src/brains/index';
import {
  createClaudeTuiBrain,
  hasDispose,
  buildBrief,
  buildTurnMessage,
  extractMove,
  extractReady
} from '../src/brains/claude-tui';

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

describe('claude-tui brain', () => {
  const briefCtx = { names, topic: 'TEST TOPIC', speaker: 'p1' as const, opponent: 'p2' as const };

  describe('buildBrief', () => {
    it('names the fighter, the opponent, the topic, and the exact marker format with the token substituted', () => {
      const brief = buildBrief(briefCtx, 'abc123');
      expect(brief).toContain('CLAUDE');
      expect(brief).toContain('CODEX');
      expect(brief).toContain('TEST TOPIC');
      expect(brief).toContain('<<<PF_MOVE token=abc123 turn=N>>>');
      expect(brief).toContain('<<<PF_END token=abc123 turn=N>>>');
      expect(brief).toContain('<<<PF_READY token=abc123>>>');
    });

    // Regression guard for the readiness-handshake bug. The brief has to spell the READY
    // marker out in order to describe it, so it can only ever be delivered as a launch
    // -argument FILE, never typed into the TUI: the pane echoes anything sent to it, so a
    // typed brief puts a literal READY marker on the pane before the model has spoken and
    // `extractReady` matches our own instructions. Observed live — the handshake reported
    // success instantly every time, and would have done so even if the brief never
    // arrived. If this ever goes back to being sent via `sendLine`, that bug is back.
    it('is delivered as a file, so its own marker text can never be echoed onto the pane', () => {
      const brief = buildBrief(briefCtx, 'abc123');
      const pane = `some earlier pane content\n${brief}\n`;
      // Proof of the hazard: were this text ever echoed, readiness would match on it.
      expect(extractReady(pane, 'abc123')).toBe(true);
      // And proof it is not: launching only ever puts the bare filename on the pane.
      expect(extractReady('cd /tmp/pf-brain-abc123 && claude \'brief.txt\'', 'abc123')).toBe(false);
    });
  });

  describe('buildTurnMessage', () => {
    it('opens the debate on the topic when there is no prior opponent text', () => {
      const msg = buildTurnMessage(ctx({ turnIndex: 0 }), 'tok1');
      expect(msg).toContain('Open the debate');
      expect(msg).toContain('TEST TOPIC');
      expect(msg).toContain('turn=0');
    });

    it('quotes the opponent last message and asks for a response when one exists', () => {
      const msg = buildTurnMessage(
        ctx({ turnIndex: 4, lastOpponentText: 'Why should anyone believe that?' }),
        'tok1'
      );
      expect(msg).toContain('Why should anyone believe that?');
      expect(msg).toContain('turn=4');
    });

    it('never spans multiple lines — safe to send as a single tmux send-keys burst', () => {
      expect(buildTurnMessage(ctx({ turnIndex: 1, lastOpponentText: 'x' }), 'tok1')).not.toContain('\n');
    });
  });

  describe('extractMove', () => {
    it('extracts the reply text between the markers for the exact token and turn', () => {
      const pane = [
        'some earlier TUI chrome',
        '<<<PF_MOVE token=tok1 turn=2>>>',
        'This is my genuine reply to the point.',
        '<<<PF_END token=tok1 turn=2>>>',
        '> '
      ].join('\n');
      expect(extractMove(pane, 'tok1', 2)).toBe('This is my genuine reply to the point.');
    });

    it('returns undefined when no block for this exact turn exists yet', () => {
      const pane = '<<<PF_MOVE token=tok1 turn=1>>>\nold reply\n<<<PF_END token=tok1 turn=1>>>';
      expect(extractMove(pane, 'tok1', 2)).toBeUndefined();
    });

    it('ignores a block for a different token (a different fighter window)', () => {
      const pane = '<<<PF_MOVE token=other turn=2>>>\nnot mine\n<<<PF_END token=other turn=2>>>';
      expect(extractMove(pane, 'tok1', 2)).toBeUndefined();
    });

    it('rejoins a terminal-wrapped multi-line reply and strips TUI box-drawing prefixes', () => {
      const pane = [
        '<<<PF_MOVE token=tok1 turn=3>>>',
        '│ This reply got wrapped across',
        '│ two rendered terminal lines.',
        '<<<PF_END token=tok1 turn=3>>>'
      ].join('\n');
      expect(extractMove(pane, 'tok1', 3)).toBe('This reply got wrapped across two rendered terminal lines.');
    });
  });

  describe('extractReady', () => {
    it('is true once the READY marker for this token appears', () => {
      expect(extractReady('blah <<<PF_READY token=tok1>>> blah', 'tok1')).toBe(true);
    });

    it('is false when the token does not match or the marker is absent', () => {
      expect(extractReady('no marker here', 'tok1')).toBe(false);
      expect(extractReady('<<<PF_READY token=other>>>', 'tok1')).toBe(false);
    });
  });

  describe('hasDispose', () => {
    it('is true for a claude-tui brain and false for local/openrouter brains', () => {
      expect(hasDispose(createClaudeTuiBrain())).toBe(true);
      expect(hasDispose(createLocalBrain())).toBe(false);
      expect(hasDispose(createOpenRouterBrain({ apiKey: undefined }))).toBe(false);
    });
  });

  it('is labeled "claude-tui" so a done-marker can say exactly which brain ran', () => {
    expect(createClaudeTuiBrain().kind).toBe('claude-tui');
  });

  it('is created by the shared createBrain() factory when kind is "claude-tui"', () => {
    const brain = createBrain('claude-tui');
    expect(brain.kind).toBe('claude-tui');
    expect(hasDispose(brain)).toBe(true);
  });
});
