/** Pure stdout formatting for `CombatEvent`s — kept separate from `runner.ts` and
 * `fight.ts` so it can be unit tested without spawning a process. */

import type { CombatEvent, MatchState, Speaker } from '../engine/types';

export type Names = Record<Speaker, string>;

/** Strips C0 control characters (\x00-\x1F) and DEL (\x7F) — including ESC (\x1B), which
 * is what lets a terminal interpret an ANSI/CSI sequence — from opponent-supplied text
 * before it is ever interpolated into a string we print to the terminal. This is the
 * single choke point both the local CLI (fight.ts) and the --connect client (client.ts)
 * print opponent text through, so sanitizing here covers both call paths. */
export function sanitizeForTerminal(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f]/g, '');
}

export function formatTurnHeader(speaker: Speaker, names: Names, text: string): string {
  return `${names[speaker]} (${speaker}): "${sanitizeForTerminal(text)}"`;
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
