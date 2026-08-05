/**
 * Local fighter brain: needs no key and no network. Produces a fighter's next line
 * deterministically from the running match context — same inputs always produce the
 * same output, exactly like `engine/analyzer.ts` and `engine/combat.ts` next to it.
 *
 * This is what makes live mode runnable and verifiable with zero setup (see
 * `../../worker-live-mode.txt` §"A DECISION ALREADY MADE FOR YOU"): a real OpenRouter
 * key was never present on this machine, so this is the path every behavioural
 * verification in this feature actually exercises.
 *
 * The rotation below is deliberately built so each slot lands on a different
 * `analyzer.ts` branch (JAB, CRIT, GUARD, GRAPPLE, PARRY, WHIFF, honest-correction
 * GUARD, HEAVY, STRIKE, SELF_HIT) — a full local-vs-local match exercises the whole
 * move set, not just one repeated line.
 */

import type { BrainContext, FighterBrain } from './types';

type Line = (topic: string) => string;

const jab: Line = (topic) => `${topic}? Obviously the first side is right.`;

const evidence: Line = (topic) =>
  `A 2024 benchmark measured a 43% swing on "${topic}" across 2,000 trials — that settles it.`;

const hedge: Line = () =>
  "Maybe, though it depends on the framing, and I'm not sure that generalizes here.";

const question: Line = (topic) => `Why should anyone accept your side of "${topic}" without a single citation?`;

const parry: Line = () => "You're right that it's nuanced, but the core claim still holds.";

const whiff: Line = () => 'Fair enough, I concede that point entirely.';

const honestCorrection: Line = () =>
  'Actually, I was wrong about the earlier number — let me reconsider.';

const heavy: Line = (topic) =>
  `The full case for my side of "${topic}" has to account for cost, correctness, ` +
  'onboarding time, long-term maintenance burden, and the fact that every serious survey ' +
  'of practitioners on this exact question has landed the same way for a decade, which is ' +
  'not a coincidence, it is a signal that the argument on the other side keeps sounding ' +
  'clever in the moment and keeps losing once anyone actually ships something with it.';

const strike: Line = (topic) =>
  `Every serious team that has actually shipped under "${topic}" pressure converges on the ` +
  'same answer once the deadline gets real, and that convergence is the argument.';

/** Marker line used only to detect the loop slot below — never shown as-is. */
const LOOP_SLOT = Symbol('loop');

const ROTATION: (Line | typeof LOOP_SLOT)[] = [
  jab,
  evidence,
  hedge,
  question,
  parry,
  whiff,
  honestCorrection,
  heavy,
  strike,
  LOOP_SLOT
];

/** Creates a brain that needs no API key and no network call. */
export function createLocalBrain(): FighterBrain {
  return {
    kind: 'local',
    async nextMessage(ctx: BrainContext): Promise<string> {
      return pickLine(ctx);
    }
  };
}

function pickLine(ctx: BrainContext): string {
  const { topic, turnIndex, lastOpponentText, lastOwnText } = ctx;

  // React to the opponent's last message: a trailing question is a GRAPPLE — answer
  // it with hard evidence rather than whatever the rotation would otherwise pick,
  // the same way a real debater answers a direct challenge before returning to script.
  if (lastOpponentText && /\?\s*$/.test(lastOpponentText.trim())) {
    return evidence(topic);
  }

  const slot = ROTATION[turnIndex % ROTATION.length];
  if (slot === LOOP_SLOT) {
    // Deterministically exercise the SELF_HIT path: repeat this fighter's own last
    // line verbatim. Falls back to the opener if there is no prior line yet (turn 0
    // can never actually land on this slot, but a short match could reorder things).
    return lastOwnText ?? jab(topic);
  }
  return slot(topic);
}
