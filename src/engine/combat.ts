/**
 * Turns a MoveIntent plus the player's chosen stance into concrete combat events
 * and mutates match state. Pure apart from that mutation — no timers, no rendering.
 */

import { applyAbilities, legacySuperDamage } from './abilities';
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
    p1: {
      id: 'p1',
      name: p1Name,
      credibility: MAX_CREDIBILITY,
      meter: 0,
      combo: 0,
      roundsWon: 0,
      shield: 0
    },
    p2: {
      id: 'p2',
      name: p2Name,
      credibility: MAX_CREDIBILITY,
      meter: 0,
      combo: 0,
      roundsWon: 0,
      shield: 0
    },
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

  // Preliminary super check drives which half of a fighter's ability kit can even
  // be considered — deliberately computed from the RAW meter gain only (never
  // including an ability's own meter bonus), so triggering an ability can never
  // retroactively decide whether this turn counted as a super.
  const meterAfterGain = Math.min(MAX_METER, atk.meter + intent.meterGain);
  const isSuper = meterAfterGain >= MAX_METER && intent.power > 0;

  const comboDamage = intent.power * (1 + atk.combo * 0.1);
  const baseDamage = isSuper ? legacySuperDamage(intent.power) : comboDamage;

  const abilities = applyAbilities({
    fighterName: atk.name,
    intent,
    attacker,
    isSuper,
    baseDamage
  });

  let damage = abilities.damage;
  let crit = intent.kind === 'CRIT';
  let countered = false;

  if (abilities.heal > 0) {
    atk.credibility = Math.min(MAX_CREDIBILITY, atk.credibility + abilities.heal);
  }
  if (abilities.shield > 0) {
    atk.shield += abilities.shield;
  }
  if (abilities.selfDamage > 0) {
    atk.credibility = Math.max(0, atk.credibility - abilities.selfDamage);
  }
  if (abilities.comboReset) {
    def.combo = 0;
  }

  // A super always drains the meter to zero regardless of any ability's own meter
  // bonus (there is nothing left to bank once the bar has just been spent).
  atk.meter = isSuper ? 0 : Math.min(MAX_METER, meterAfterGain + abilities.meterBonus);
  events.push({ type: 'meter', who: attacker, value: atk.meter });

  events.push(...abilities.events);

  if (isSuper) {
    crit = true;
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

  // Every credibility-affecting hit this turn (the main attack, plus a super's
  // direct drain if one fired) goes through the same shield-absorption step —
  // a fighter's shield always eats damage before credibility does, whichever
  // source the damage came from.
  const outcome: { hits: { target: Speaker; amount: number; blocked: boolean; crit: boolean }[] } = {
    hits: []
  };

  if (!countered && damage > 0) {
    outcome.hits.push({ target: defender, amount: damage, blocked, crit });
  } else if (!countered && intent.power === 0 && intent.selfDamage === 0 && abilities.drain === 0) {
    events.push({ type: 'whiff', by: attacker });
  }

  if (!countered && abilities.drain > 0) {
    outcome.hits.push({ target: defender, amount: abilities.drain, blocked: false, crit: false });
  }

  for (const hit of outcome.hits) {
    const target = state[hit.target];
    const absorbed = Math.min(target.shield, hit.amount);
    target.shield -= absorbed;
    const remaining = hit.amount - absorbed;
    if (remaining <= 0) continue;
    target.credibility = Math.max(0, target.credibility - remaining);
    events.push(
      hit.blocked
        ? { type: 'blocked', target: hit.target, damage: remaining }
        : { type: 'hit', target: hit.target, damage: remaining, crit: hit.crit }
    );
  }

  for (const side of ['p1', 'p2'] as const) {
    if (state[side].credibility <= 0) events.push({ type: 'ko', loser: side });
  }

  return events;
}
