/** Pure stdout formatting for `CombatEvent`s — kept separate from `runner.ts` and
 * `fight.ts` so it can be unit tested without spawning a process. */

import type { CombatEvent, MatchState, Speaker } from '../engine/types';

export type Names = Record<Speaker, string>;

export function formatTurnHeader(speaker: Speaker, names: Names, text: string): string {
  return `\n${names[speaker]} (${speaker}): "${text}"`;
}

export function formatEvent(event: CombatEvent, names: Names): string | null {
  switch (event.type) {
    case 'attack':
      return `  -> ${names[event.by]} throws ${event.kind} [${event.label}]`;
    case 'hit':
      return `     hits ${names[event.target]} for ${event.damage} dmg${event.crit ? ' (CRIT)' : ''}`;
    case 'blocked':
      return `     ${names[event.target]} blocks — ${event.damage} chip dmg`;
    case 'counter':
      return `     COUNTER by ${names[event.by]} for ${event.damage} dmg`;
    case 'whiff':
      return `     ${names[event.by]} whiffs`;
    case 'combo':
      return `     combo x${event.count} (${names[event.by]})`;
    case 'comboBreak':
      return `     combo broken (${names[event.by]})`;
    case 'meter':
      return `     ${names[event.who]} meter -> ${event.value}`;
    case 'super':
      return `  *** ${names[event.by]} unleashes ${event.name} for ${event.damage} dmg ***`;
    case 'ability':
      return `     [${event.owner}] ${event.name}: ${event.effect} ${event.amount}`;
    case 'ko':
      return `  !!! ${names[event.loser]}'S ARGUMENT COLLAPSED !!!`;
    case 'roundEnd':
      return `\n=== ROUND ${event.round} END — ${
        event.winner ? `${names[event.winner]} WINS THE ROUND` : 'DRAW'
      } ===`;
    case 'matchEnd':
      return `\n### MATCH OVER — WINNER: ${names[event.winner]} ###`;
    case 'announce':
      return `  [${event.text}]`;
    default:
      return null;
  }
}

export function formatCredibility(state: MatchState, names: Names): string {
  return formatCredibilityLine(state.p1.credibility, state.p2.credibility, state.round, names);
}

/** Same line `formatCredibility` prints, but from just the three numbers a network
 * snapshot carries — used by the remote client, which never holds a full
 * `MatchState` (that would mean duplicating engine state on the client). */
export function formatCredibilityLine(p1: number, p2: number, round: number, names: Names): string {
  return `     credibility: ${names.p1} ${p1}/100 | ${names.p2} ${p2}/100 (round ${round})`;
}
