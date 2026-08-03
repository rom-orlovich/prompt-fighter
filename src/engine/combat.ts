/**
 * Turns a MoveIntent plus the player's chosen stance into concrete combat events
 * and mutates match state. Pure apart from that mutation — no timers, no rendering.
 */

import { MAX_CREDIBILITY, MAX_METER } from './types';
import type { CombatEvent, MatchState, MoveIntent, PlayerAction, Speaker } from './types';

export const SUPER_NAMES: Record<string, string> = {
  CLAUDE: 'CONSTITUTIONAL BARRIER',
  CODEX: 'CONFIDENT FABRICATION',
  GEMINI: 'CONTEXT WINDOW SLAM',
  'LOCAL 7B': 'FAST INFERENCE'
};

export function newMatch(
  playerSide: Speaker = 'p1',
  p1Name = 'CLAUDE',
  p2Name = 'CODEX'
): MatchState {
  return {
    p1: { id: 'p1', name: p1Name, credibility: MAX_CREDIBILITY, meter: 0, combo: 0, roundsWon: 0 },
    p2: { id: 'p2', name: p2Name, credibility: MAX_CREDIBILITY, meter: 0, combo: 0, roundsWon: 0 },
    round: 1,
    playerSide
  };
}

const other = (s: Speaker): Speaker => (s === 'p1' ? 'p2' : 'p1');

export interface ResolveInput {
  attacker: Speaker;
  intent: MoveIntent;
  /** The stance the human locked in for this exchange. */
  playerAction: PlayerAction;
  state: MatchState;
}

export function resolve(input: ResolveInput): CombatEvent[] {
  const { attacker, intent, playerAction, state } = input;
  const defender = other(attacker);
  const atk = state[attacker];
  const def = state[defender];
  const events: CombatEvent[] = [];

  events.push({
    type: 'attack',
    by: attacker,
    kind: intent.kind,
    label: intent.label,
    tags: intent.tags
  });

  // Combo is tracked before damage so this hit already benefits from the multiplier.
  if (intent.continuesThread && intent.power > 0) {
    atk.combo += 1;
    events.push({ type: 'combo', by: attacker, count: atk.combo });
  } else if (atk.combo > 0) {
    atk.combo = 0;
    events.push({ type: 'comboBreak', by: attacker });
  }

  // Looping, conceding and self-correcting all cost the speaker credibility.
  if (intent.selfDamage > 0) {
    atk.credibility = Math.max(0, atk.credibility - intent.selfDamage);
    events.push({ type: 'hit', target: attacker, damage: intent.selfDamage, crit: false });
  }

  atk.meter = Math.min(MAX_METER, atk.meter + intent.meterGain);
  events.push({ type: 'meter', who: attacker, value: atk.meter });

  let damage = intent.power * (1 + atk.combo * 0.1);
  let crit = intent.kind === 'CRIT';
  let countered = false;

  const isSuper = atk.meter >= MAX_METER && intent.power > 0;
  if (isSuper) {
    damage = 32 + intent.power * 0.5;
    crit = true;
    atk.meter = 0;
    events.push({
      type: 'super',
      by: attacker,
      name: SUPER_NAMES[atk.name] ?? 'FINAL ARGUMENT',
      damage
    });
    events.push({ type: 'meter', who: attacker, value: 0 });
  }

  const playerIsDefending = defender === state.playerSide;
  let blocked = false;

  if (playerIsDefending) {
    switch (playerAction) {
      case 'GUARD':
        damage *= 0.4;
        blocked = true;
        def.meter = Math.min(MAX_METER, def.meter + 12);
        events.push({ type: 'meter', who: defender, value: def.meter });
        break;

      case 'UNDERCUT':
        // Punish overcommitment: a long argument leaves a long opening.
        if (intent.kind === 'HEAVY' && !isSuper) {
          countered = true;
          const counterDamage = Math.round(damage * 1.5);
          atk.credibility = Math.max(0, atk.credibility - counterDamage);
          atk.combo = 0;
          events.push({ type: 'counter', by: defender, damage: counterDamage });
          damage = 0;
        } else {
          damage *= 1.1;
        }
        break;

      case 'PIVOT':
        damage *= 0.7;
        atk.combo = 0;
        break;

      case 'FACT_STRIKE':
        // Evidence beats waffle: hedging into a fact check is a free counter.
        if (intent.tags.includes('hedge') && !isSuper) {
          countered = true;
          const counterDamage = 12;
          atk.credibility = Math.max(0, atk.credibility - counterDamage);
          events.push({ type: 'counter', by: defender, damage: counterDamage });
          damage = 0;
        }
        def.meter = Math.min(MAX_METER, def.meter + 15);
        events.push({ type: 'meter', who: defender, value: def.meter });
        break;

      case 'NONE':
        damage *= 1.25;
        break;
    }
  } else {
    // The player's own fighter is attacking — the stance shaped this very message.
    switch (playerAction) {
      case 'FACT_STRIKE':
        damage *= intent.tags.includes('evidence') ? 1.5 : 0.8;
        break;
      case 'UNDERCUT':
        damage *= intent.continuesThread ? 1.3 : 0.9;
        break;
      case 'PIVOT':
        damage *= 0.7;
        def.combo = 0;
        break;
      case 'GUARD':
        damage *= 0.5;
        atk.meter = Math.min(MAX_METER, atk.meter + 10);
        events.push({ type: 'meter', who: attacker, value: atk.meter });
        break;
      case 'NONE':
        damage *= 0.9;
        break;
    }
  }

  damage = Math.round(damage);

  if (!countered && damage > 0) {
    def.credibility = Math.max(0, def.credibility - damage);
    events.push(
      blocked
        ? { type: 'blocked', target: defender, damage }
        : { type: 'hit', target: defender, damage, crit }
    );
  } else if (!countered && intent.power === 0 && intent.selfDamage === 0) {
    events.push({ type: 'whiff', by: attacker });
  }

  for (const side of ['p1', 'p2'] as const) {
    if (state[side].credibility <= 0) events.push({ type: 'ko', loser: side });
  }

  return events;
}
