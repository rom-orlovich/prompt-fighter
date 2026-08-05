import { describe, it, expect } from 'vitest';
import { MatchSession } from '../src/server/session';

describe('MatchSession', () => {
  it('starts with p1 to move', () => {
    const session = new MatchSession({ p1Name: 'CLAUDE', p2Name: 'CODEX' });
    expect(session.nextSpeaker).toBe('p1');
  });

  it('rejects an out-of-order submission (p2 going before p1) — a turn submitted out of order', () => {
    const session = new MatchSession();
    expect(() => session.submitTurn('p2', 'jumping the queue')).toThrow(/not p2's turn/);
  });

  it('rejects a second submission for a turn already taken', () => {
    const session = new MatchSession();
    session.submitTurn('p1', 'A short jab.');
    expect(() => session.submitTurn('p1', 'again')).toThrow(/not p1's turn/);
  });

  it('alternates nextSpeaker after each accepted turn', () => {
    const session = new MatchSession();
    session.submitTurn('p1', 'A short jab.');
    expect(session.nextSpeaker).toBe('p2');
    session.submitTurn('p2', 'A reply.');
    expect(session.nextSpeaker).toBe('p1');
  });

  it('rejects any submission once matchOver — the match is already over', () => {
    const session = new MatchSession();
    session.engine.state.p1.roundsWon = 1; // one round from deciding the match
    session.engine.state.p2.credibility = 3;
    session.submitTurn('p1', 'x '.repeat(120)); // nextSpeaker starts p1 — this KOs p2, sealing round 2
    expect(session.matchOver).toBe(true);
    expect(() => session.submitTurn('p2', 'too late')).toThrow(/already over/);
  });

  it('hello() replays full history; turnSnapshot() carries just the one turn', () => {
    const session = new MatchSession();
    session.submitTurn('p1', 'A short jab.');
    session.submitTurn('p2', 'Another jab.');
    const hello = session.hello();
    expect(hello.turns).toHaveLength(2);
    expect(hello.events.length).toBeGreaterThan(0);

    const events = session.submitTurn('p1', 'A third jab.');
    const turn = session.turnSnapshot('p1', 'A third jab.', events);
    expect(turn.turns).toEqual([{ speaker: 'p1', text: 'A third jab.' }]);
    expect(turn.events).toEqual(events);
  });
});
