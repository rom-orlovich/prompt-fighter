/**
 * Match state machine: owns the fighters, feeds each completed message through the
 * analyzer and combat resolver, and handles rounds, KOs and match end.
 *
 * Deliberately has no timers of its own — wall-clock belongs to the render loop,
 * which calls `endRoundOnTime()` when the round clock expires.
 */

import { analyze } from './analyzer';
import { newMatch, resolve } from './combat';
import { MAX_CREDIBILITY, ROUNDS_TO_WIN } from './types';
import type { CombatEvent, MatchState, PlayerAction, Speaker } from './types';

type Listener = (event: CombatEvent) => void;

const other = (s: Speaker): Speaker => (s === 'p1' ? 'p2' : 'p1');

export class FightEngine {
  readonly state: MatchState;
  playerAction: PlayerAction = 'NONE';
  matchOver = false;

  private listeners: Listener[] = [];
  private lastText: Record<Speaker, string | undefined> = { p1: undefined, p2: undefined };

  constructor(playerSide: Speaker = 'p1', p1Name = 'CLAUDE', p2Name = 'CODEX') {
    this.state = newMatch(playerSide, p1Name, p2Name);
  }

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  setPlayerAction(action: PlayerAction): void {
    this.playerAction = action;
  }

  /** Run one finished message through the whole pipeline. */
  completeTurn(speaker: Speaker, text: string): CombatEvent[] {
    if (this.matchOver) return [];

    const intent = analyze(text, {
      previousOpponentText: this.lastText[other(speaker)],
      previousOwnText: this.lastText[speaker]
    });

    const events = resolve({
      attacker: speaker,
      intent,
      playerAction: this.playerAction,
      state: this.state
    });

    this.lastText[speaker] = text;
    this.playerAction = 'NONE';

    const ko = events.find(
      (e): e is Extract<CombatEvent, { type: 'ko' }> => e.type === 'ko'
    );
    if (ko) events.push(...this.awardRound(other(ko.loser)));

    this.emitAll(events);
    return events;
  }

  /** Round clock expired: the more credible fighter takes the round. */
  endRoundOnTime(): CombatEvent[] {
    if (this.matchOver) return [];
    const { p1, p2 } = this.state;
    const winner: Speaker | null =
      p1.credibility === p2.credibility ? null : p1.credibility > p2.credibility ? 'p1' : 'p2';

    const events: CombatEvent[] = [{ type: 'announce', text: 'TIME' }];
    events.push(...this.awardRound(winner));
    this.emitAll(events);
    return events;
  }

  private awardRound(winner: Speaker | null): CombatEvent[] {
    const events: CombatEvent[] = [];
    if (winner) this.state[winner].roundsWon += 1;

    events.push({ type: 'roundEnd', winner, round: this.state.round });

    if (winner && this.state[winner].roundsWon >= ROUNDS_TO_WIN) {
      this.matchOver = true;
      events.push({ type: 'matchEnd', winner });
      return events;
    }

    // Fresh credibility each round; the super meter deliberately carries over,
    // so an honest, meter-building round one pays off in round two.
    this.state.round += 1;
    for (const side of ['p1', 'p2'] as const) {
      this.state[side].credibility = MAX_CREDIBILITY;
      this.state[side].combo = 0;
    }
    this.lastText = { p1: undefined, p2: undefined };
    return events;
  }

  private emitAll(events: CombatEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) listener(event);
    }
  }
}
