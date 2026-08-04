/**
 * Per-fighter abilities: the mechanical personality layer on top of the generic
 * combat resolver. Every fighter in the roster gets exactly two abilities — one
 * passive that triggers on a specific move shape, and one super that triggers the
 * moment their meter is full (the same moment `combat.ts` already recognizes as a
 * super via `MAX_METER`).
 *
 * Pure and deterministic: `applyAbilities` reads a context object and returns a
 * plain outcome describing what should happen — it never touches `MatchState`
 * itself. `combat.ts` is the only place that mutates state; this file just decides
 * *what* the mutation should be. No RNG anywhere in this module.
 */

import type { MoveIntent, Speaker } from './types';

export type AbilityEffectKind =
  | 'damage'
  | 'heal'
  | 'meter'
  | 'shield'
  | 'drain'
  | 'selfDamage'
  | 'comboReset';

export type AbilityId =
  | 'SHIP_IT_RUSH'
  | 'CONFIDENT_FABRICATION'
  | 'NUANCE_RIPOSTE'
  | 'CONSTITUTIONAL_BARRIER'
  | 'MULTIMODAL_RECALL'
  | 'CONTEXT_WINDOW_SLAM'
  | 'QUANTIZED_GLITCH'
  | 'FAST_INFERENCE';

/** What `applyAbilities` needs to know to decide which abilities fire this turn. */
export interface AbilityContext {
  /** The attacking fighter's display name, e.g. "CODEX" — looked up against the roster. */
  fighterName: string;
  intent: MoveIntent;
  attacker: Speaker;
  /** Whether this turn's meter is full — supers and passives never trigger together. */
  isSuper: boolean;
  /** Damage this turn would deal before any ability adjusts it (combo-multiplied,
   * or the legacy super formula when `isSuper` is true). */
  baseDamage: number;
}

interface AbilityEffectAmount {
  effect: AbilityEffectKind;
  amount: number;
}

export interface AbilityDef {
  id: AbilityId;
  name: string;
  owner: string;
  kind: 'super' | 'passive';
  /** Which effect kinds this ability can ever produce — static metadata for the
   * catalog, independent of whether `trigger` fires on a given turn. */
  effects: AbilityEffectKind[];
  trigger: (ctx: AbilityContext) => boolean;
  apply: (ctx: AbilityContext) => AbilityEffectAmount[];
}

export interface AbilityTriggerEvent {
  type: 'ability';
  by: Speaker;
  ability: AbilityId;
  name: string;
  owner: string;
  effect: AbilityEffectKind;
  amount: number;
}

export interface AbilityOutcome {
  /** Final damage this turn should deal — `baseDamage` plus every triggered
   * ability's `damage` contribution. Unmodified when nothing triggers. */
  damage: number;
  /** Extra meter for the attacker, on top of `intent.meterGain`. */
  meterBonus: number;
  /** Credibility restored to the attacker. */
  heal: number;
  /** Shield granted to the attacker. */
  shield: number;
  /** Credibility drained directly from the defender, independent of the main hit. */
  drain: number;
  /** Extra self-damage credibility loss for the attacker, on top of `intent.selfDamage`. */
  selfDamage: number;
  /** Whether the defender's combo should reset. */
  comboReset: boolean;
  events: AbilityTriggerEvent[];
}

/** Legacy super-damage formula, kept as the seed every super builds on — this is
 * exactly what `combat.ts` used to hardcode before abilities existed, so a fighter
 * with no registered abilities (or none that trigger) behaves identically. */
export function legacySuperDamage(power: number): number {
  return 32 + power * 0.5;
}

const emptyOutcome = (baseDamage: number): AbilityOutcome => ({
  damage: baseDamage,
  meterBonus: 0,
  heal: 0,
  shield: 0,
  drain: 0,
  selfDamage: 0,
  comboReset: false,
  events: []
});

// --- CLAUDE ------------------------------------------------------------------

const NUANCE_RIPOSTE: AbilityDef = {
  id: 'NUANCE_RIPOSTE',
  name: 'NUANCE RIPOSTE',
  owner: 'CLAUDE',
  kind: 'passive',
  effects: ['heal'],
  trigger: (ctx) => !ctx.isSuper && ctx.intent.kind === 'PARRY',
  apply: () => [{ effect: 'heal', amount: 12 }]
};

const CONSTITUTIONAL_BARRIER: AbilityDef = {
  id: 'CONSTITUTIONAL_BARRIER',
  name: 'CONSTITUTIONAL BARRIER',
  owner: 'CLAUDE',
  kind: 'super',
  effects: ['shield', 'heal'],
  trigger: (ctx) => ctx.isSuper,
  apply: () => [
    { effect: 'shield', amount: 20 },
    { effect: 'heal', amount: 15 }
  ]
};

// --- CODEX ---------------------------------------------------------------

const SHIP_IT_RUSH: AbilityDef = {
  id: 'SHIP_IT_RUSH',
  name: 'SHIP IT RUSH',
  owner: 'CODEX',
  kind: 'passive',
  effects: ['damage'],
  trigger: (ctx) => !ctx.isSuper && ctx.intent.power > 0 && ctx.intent.tags.includes('assertive'),
  apply: (ctx) => [{ effect: 'damage', amount: Math.round(ctx.intent.power * 0.5) }]
};

const CONFIDENT_FABRICATION: AbilityDef = {
  id: 'CONFIDENT_FABRICATION',
  name: 'CONFIDENT FABRICATION',
  owner: 'CODEX',
  kind: 'super',
  effects: ['damage', 'selfDamage'],
  trigger: (ctx) => ctx.isSuper,
  apply: () => [
    { effect: 'damage', amount: 18 },
    { effect: 'selfDamage', amount: 10 }
  ]
};

// --- GEMINI ----------------------------------------------------------------

const MULTIMODAL_RECALL: AbilityDef = {
  id: 'MULTIMODAL_RECALL',
  name: 'MULTIMODAL RECALL',
  owner: 'GEMINI',
  kind: 'passive',
  effects: ['meter'],
  trigger: (ctx) => !ctx.isSuper && ctx.intent.kind === 'CRIT',
  apply: () => [{ effect: 'meter', amount: 15 }]
};

const CONTEXT_WINDOW_SLAM: AbilityDef = {
  id: 'CONTEXT_WINDOW_SLAM',
  name: 'CONTEXT WINDOW SLAM',
  owner: 'GEMINI',
  kind: 'super',
  effects: ['damage', 'drain'],
  trigger: (ctx) => ctx.isSuper,
  apply: () => [
    { effect: 'damage', amount: 12 },
    { effect: 'drain', amount: 10 }
  ]
};

// --- LOCAL 7B ----------------------------------------------------------------

const QUANTIZED_GLITCH: AbilityDef = {
  id: 'QUANTIZED_GLITCH',
  name: 'QUANTIZED GLITCH',
  owner: 'LOCAL 7B',
  kind: 'passive',
  effects: ['damage', 'selfDamage'],
  trigger: (ctx) => !ctx.isSuper && ctx.intent.kind === 'JAB' && ctx.intent.power > 0,
  apply: () => [
    { effect: 'damage', amount: 6 },
    { effect: 'selfDamage', amount: 4 }
  ]
};

const FAST_INFERENCE: AbilityDef = {
  id: 'FAST_INFERENCE',
  name: 'FAST INFERENCE',
  owner: 'LOCAL 7B',
  kind: 'super',
  effects: ['meter', 'selfDamage'],
  trigger: (ctx) => ctx.isSuper,
  apply: () => [
    { effect: 'meter', amount: 20 },
    { effect: 'selfDamage', amount: 8 }
  ]
};

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  SHIP_IT_RUSH,
  CONFIDENT_FABRICATION,
  NUANCE_RIPOSTE,
  CONSTITUTIONAL_BARRIER,
  MULTIMODAL_RECALL,
  CONTEXT_WINDOW_SLAM,
  QUANTIZED_GLITCH,
  FAST_INFERENCE
};

export const FIGHTER_ABILITIES: Record<string, AbilityId[]> = {
  CLAUDE: ['NUANCE_RIPOSTE', 'CONSTITUTIONAL_BARRIER'],
  CODEX: ['SHIP_IT_RUSH', 'CONFIDENT_FABRICATION'],
  GEMINI: ['MULTIMODAL_RECALL', 'CONTEXT_WINDOW_SLAM'],
  'LOCAL 7B': ['QUANTIZED_GLITCH', 'FAST_INFERENCE']
};

/** The ability ids owned by a fighter, or an empty list for an unrecognized model —
 * an unknown fighter simply plays with no abilities, not an error. */
export function abilitiesFor(fighterName: string): AbilityId[] {
  return FIGHTER_ABILITIES[fighterName] ?? [];
}

/**
 * Pure: given the same context, always returns the same outcome. Aggregates every
 * triggered ability's effects into one outcome combat.ts can apply to state.
 */
export function applyAbilities(ctx: AbilityContext): AbilityOutcome {
  const ids = abilitiesFor(ctx.fighterName);
  if (ids.length === 0) return emptyOutcome(ctx.baseDamage);

  const outcome = emptyOutcome(ctx.baseDamage);
  outcome.damage = ctx.baseDamage;

  for (const id of ids) {
    const def = ABILITIES[id];
    // Passives only fire on a normal turn, supers only fire on a full-meter turn —
    // never both at once, so effects from the two halves of a fighter's kit never mix.
    if (def.kind === 'super' && !ctx.isSuper) continue;
    if (def.kind === 'passive' && ctx.isSuper) continue;
    if (!def.trigger(ctx)) continue;

    for (const { effect, amount } of def.apply(ctx)) {
      switch (effect) {
        case 'damage':
          outcome.damage += amount;
          break;
        case 'meter':
          outcome.meterBonus += amount;
          break;
        case 'heal':
          outcome.heal += amount;
          break;
        case 'shield':
          outcome.shield += amount;
          break;
        case 'drain':
          outcome.drain += amount;
          break;
        case 'selfDamage':
          outcome.selfDamage += amount;
          break;
        case 'comboReset':
          outcome.comboReset = true;
          break;
      }
      outcome.events.push({
        type: 'ability',
        by: ctx.attacker,
        ability: def.id,
        name: def.name,
        owner: def.owner,
        effect,
        amount
      });
    }
  }

  return outcome;
}
