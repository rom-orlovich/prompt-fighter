/**
 * Shared combat contracts.
 *
 * Nothing in `engine/` may import Three.js or touch the DOM: every rule here is a
 * pure data transformation, which is what lets the whole game be tested headlessly.
 */

export type Speaker = 'p1' | 'p2';

export type MoveKind =
  | 'JAB'
  | 'STRIKE'
  | 'HEAVY'
  | 'CRIT'
  | 'PARRY'
  | 'GUARD'
  | 'GRAPPLE'
  | 'WHIFF'
  | 'SELF_HIT'
  | 'SUPER';

export type MoveTag =
  | 'evidence'
  | 'hedge'
  | 'assertive'
  | 'question'
  | 'concession'
  | 'self-correction'
  | 'topic-shift'
  | 'loop';

export type PlayerAction = 'FACT_STRIKE' | 'UNDERCUT' | 'PIVOT' | 'GUARD' | 'NONE';

export interface AnalyzeContext {
  /** The opponent's previous message — used to detect topic shifts. */
  previousOpponentText?: string;
  /** The speaker's own previous message — used to detect looping. */
  previousOwnText?: string;
}

/** What a single message means in combat terms. */
export interface MoveIntent {
  kind: MoveKind;
  power: number;
  tags: MoveTag[];
  continuesThread: boolean;
  meterGain: number;
  selfDamage: number;
  /** Short announcer-facing description, e.g. "CITED EVIDENCE". */
  label: string;
}

export interface FighterState {
  id: Speaker;
  name: string;
  credibility: number;
  meter: number;
  combo: number;
  roundsWon: number;
}

export interface MatchState {
  p1: FighterState;
  p2: FighterState;
  round: number;
  /** Which fighter the human is coaching. */
  playerSide: Speaker;
}

export type CombatEvent =
  | { type: 'attack'; by: Speaker; kind: MoveKind; label: string; tags: MoveTag[] }
  | { type: 'hit'; target: Speaker; damage: number; crit: boolean }
  | { type: 'blocked'; target: Speaker; damage: number }
  | { type: 'counter'; by: Speaker; damage: number }
  | { type: 'whiff'; by: Speaker }
  | { type: 'combo'; by: Speaker; count: number }
  | { type: 'comboBreak'; by: Speaker }
  | { type: 'meter'; who: Speaker; value: number }
  | { type: 'super'; by: Speaker; name: string; damage: number }
  | { type: 'ko'; loser: Speaker }
  | { type: 'roundEnd'; winner: Speaker | null; round: number }
  | { type: 'matchEnd'; winner: Speaker }
  | { type: 'announce'; text: string };

export const MAX_CREDIBILITY = 100;
export const MAX_METER = 100;
export const ROUNDS_TO_WIN = 2;
