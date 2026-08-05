/**
 * The server's authoritative match state: one `FightEngine`, owned here, never
 * duplicated on a client. Every accepted turn goes through `engine.completeTurn()` —
 * the identical call `simulate.ts` and the CLI's `runLiveMatch` make — so the
 * network transport in `http.ts` cannot introduce any rule divergence; it can only
 * decide *whether* to forward a submission to this call.
 *
 * Turn order is tracked here (alternating p1/p2, starting p1) rather than in the
 * engine, exactly like `sources/live.ts` and `simulate.ts` both decide it
 * independently the same way — nothing about whose turn it is lives in the engine.
 */

import { FightEngine } from '../engine/match';
import type { CombatEvent, Speaker } from '../engine/types';

export interface MatchSessionOptions {
  playerSide?: Speaker;
  p1Name?: string;
  p2Name?: string;
  topic?: string;
}

export interface TurnRecord {
  speaker: Speaker;
  text: string;
}

/** Broadcast to every client on connect and after every accepted turn. */
export interface SessionSnapshot {
  type: 'hello' | 'turn';
  topic: string;
  names: { p1: string; p2: string };
  nextSpeaker: Speaker;
  matchOver: boolean;
  credibility: { p1: number; p2: number };
  round: number;
  /** Full turn history on `hello` (so a late/reconnecting client can rebuild brain
   * context and replay the fight); just this turn on `turn`. */
  turns: TurnRecord[];
  /** Same split as `turns`: full event history on `hello`, just this turn's events
   * on `turn`. */
  events: CombatEvent[];
}

export class MatchSession {
  readonly engine: FightEngine;
  readonly topic: string;
  readonly names: { p1: string; p2: string };
  nextSpeaker: Speaker = 'p1';
  matchOver = false;
  history: CombatEvent[] = [];
  turns: TurnRecord[] = [];

  constructor(options: MatchSessionOptions = {}) {
    const p1Name = options.p1Name ?? 'CLAUDE';
    const p2Name = options.p2Name ?? 'CODEX';
    this.engine = new FightEngine(options.playerSide ?? 'p1', p1Name, p2Name);
    this.topic = options.topic ?? 'LIVE MODE: WHICH MODEL ARGUES BETTER';
    this.names = { p1: p1Name, p2: p2Name };
    this.engine.on((event) => this.history.push(event));
  }

  /** Throws a plain `Error` (never a stack trace to the wire — `http.ts` turns it
   * into a 409 with the message) when the submission is out of turn or the match is
   * already decided. This is the one place "second client joining", "out-of-order
   * turn" and "match already over" are rejected — simply and predictably. */
  submitTurn(speaker: Speaker, text: string): CombatEvent[] {
    if (this.matchOver) throw new Error('match is already over');
    if (speaker !== this.nextSpeaker) {
      throw new Error(`not ${speaker}'s turn (next: ${this.nextSpeaker})`);
    }

    const before = this.history.length;
    this.engine.completeTurn(speaker, text);
    const events = this.history.slice(before);

    this.turns.push({ speaker, text });
    this.nextSpeaker = speaker === 'p1' ? 'p2' : 'p1';
    if (this.engine.matchOver) this.matchOver = true;
    return events;
  }

  private credibility() {
    return { p1: this.engine.state.p1.credibility, p2: this.engine.state.p2.credibility };
  }

  hello(): SessionSnapshot {
    return {
      type: 'hello',
      topic: this.topic,
      names: this.names,
      nextSpeaker: this.nextSpeaker,
      matchOver: this.matchOver,
      credibility: this.credibility(),
      round: this.engine.state.round,
      turns: this.turns,
      events: this.history
    };
  }

  turnSnapshot(speaker: Speaker, text: string, events: CombatEvent[]): SessionSnapshot {
    return {
      type: 'turn',
      topic: this.topic,
      names: this.names,
      nextSpeaker: this.nextSpeaker,
      matchOver: this.matchOver,
      credibility: this.credibility(),
      round: this.engine.state.round,
      turns: [{ speaker, text }],
      events
    };
  }
}
