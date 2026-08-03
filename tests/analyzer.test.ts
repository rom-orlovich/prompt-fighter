import { describe, it, expect } from 'vitest';
import { analyze } from '../src/engine/analyzer';

const ctx = {};

describe('analyze', () => {
  it('maps a short sharp reply to JAB', () => {
    expect(analyze('No. That is a scaling myth.', ctx).kind).toBe('JAB');
  });

  it('maps a medium reply to STRIKE', () => {
    const mid = 'the operational overhead of a control plane is real for small teams ' +
      'and it competes directly with feature work every single sprint';
    expect(analyze(mid, ctx).kind).toBe('STRIKE');
  });

  it('maps a long detailed reply to HEAVY', () => {
    const long = 'consider the operational overhead here carefully '.repeat(20);
    expect(analyze(long, ctx).kind).toBe('HEAVY');
  });

  it('maps concrete evidence to CRIT', () => {
    const m = analyze('Latency dropped 43% after the change, measured over 2000 requests.', ctx);
    expect(m.kind).toBe('CRIT');
    expect(m.tags).toContain('evidence');
  });

  it('treats a fenced code block as evidence', () => {
    expect(analyze('Here:\n```ts\nconst x = 1;\n```', ctx).kind).toBe('CRIT');
  });

  it('maps hedging to GUARD', () => {
    const m = analyze('Well, it depends, and I am not sure that always holds.', ctx);
    expect(m.kind).toBe('GUARD');
    expect(m.tags).toContain('hedge');
  });

  it('maps a trailing question to GRAPPLE', () => {
    expect(analyze('What happens when the queue backs up?', ctx).kind).toBe('GRAPPLE');
  });

  it('maps "I agree, but" to PARRY', () => {
    expect(analyze('I agree, but that only holds under low load.', ctx).kind).toBe('PARRY');
  });

  it('maps plain concession to WHIFF with self damage', () => {
    const m = analyze('You are right. I concede that.', ctx);
    expect(m.kind).toBe('WHIFF');
    expect(m.selfDamage).toBeGreaterThan(0);
  });

  it('maps self-correction to credibility loss plus large meter gain', () => {
    const m = analyze('Actually, I was wrong about the throughput claim.', ctx);
    expect(m.tags).toContain('self-correction');
    expect(m.selfDamage).toBeGreaterThan(0);
    expect(m.meterGain).toBeGreaterThanOrEqual(25);
  });

  it('maps repeating yourself to SELF_HIT', () => {
    const own = 'Kubernetes adds operational overhead for small teams.';
    const m = analyze('Kubernetes adds operational overhead for small teams.', {
      previousOwnText: own
    });
    expect(m.kind).toBe('SELF_HIT');
    expect(m.tags).toContain('loop');
  });

  it('flags continuing the opponent thread', () => {
    const m = analyze('That overhead argument ignores managed control planes.', {
      previousOpponentText: 'The overhead of running a control plane is the real cost.'
    });
    expect(m.continuesThread).toBe(true);
  });

  it('flags a topic shift', () => {
    const m = analyze('Anyway, tabs are objectively better than spaces.', {
      previousOpponentText: 'The overhead of running a control plane is the real cost.'
    });
    expect(m.continuesThread).toBe(false);
    expect(m.tags).toContain('topic-shift');
  });

  it('always produces a human-readable label', () => {
    expect(analyze('No.', ctx).label.length).toBeGreaterThan(0);
  });
});
