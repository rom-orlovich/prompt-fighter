/**
 * Deterministic per-bot fighter selection.
 *
 * Nothing in `engine/` may import Three.js or touch the DOM (see `types.ts`); this
 * module additionally must not use `Math.random` or `Date` and must perform no I/O —
 * the same input must always produce the same output.
 */

/** The fixed eight-fighter roster (original four first, then the expansion four). */
export const FIGHTER_IDS = [
  'CLAUDE',
  'CODEX',
  'GEMINI',
  'LOCAL 7B',
  'IRON_FIST',
  'VIPER',
  'WARDEN',
  'BLAZE'
] as const;

export type FighterId = (typeof FIGHTER_IDS)[number];

/** Trim surrounding whitespace and uppercase — the canonical comparison form. */
export function normaliseModelName(modelName: string): string {
  return modelName.trim().toUpperCase();
}

/**
 * FNV-1a 32-bit hash of a model name, computed over its normalised form.
 * Uses `Math.imul` for correct 32-bit multiplication and `>>> 0` to force an
 * unsigned (non-negative) integer result.
 */
export function hashModelName(modelName: string): number {
  const normalised = normaliseModelName(modelName);
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}

/** Deterministically maps a model name to a roster fighter via hash modulo. */
export function fighterForModel(modelName: string): FighterId {
  const index = hashModelName(modelName) % FIGHTER_IDS.length;
  return FIGHTER_IDS[index];
}

export type FighterSource = 'transcript' | 'hash';

export interface FighterSelectionInput {
  modelName: string;
  transcriptFighter?: string;
}

export interface FighterSelectionResult {
  fighter: FighterId;
  source: FighterSource;
  modelName: string;
}

function isKnownFighter(candidate: string): candidate is FighterId {
  return (FIGHTER_IDS as readonly string[]).includes(candidate);
}

/**
 * Selects a fighter for one side. A transcript-named fighter wins only if it
 * normalises to a known roster id; otherwise falls back to the deterministic hash.
 */
export function selectFighter({
  modelName,
  transcriptFighter
}: FighterSelectionInput): FighterSelectionResult {
  if (transcriptFighter !== undefined) {
    const normalised = normaliseModelName(transcriptFighter);
    if (isKnownFighter(normalised)) {
      return { fighter: normalised, source: 'transcript', modelName };
    }
  }
  return { fighter: fighterForModel(modelName), source: 'hash', modelName };
}

export interface MatchupSelectionResult {
  p1: FighterSelectionResult;
  p2: FighterSelectionResult;
}

/**
 * Selects both sides of a matchup independently. A mirror match (both sides
 * resolving to the same fighter) is legal and expected for identical inputs.
 */
export function selectMatchup(
  p1: FighterSelectionInput,
  p2: FighterSelectionInput
): MatchupSelectionResult {
  return {
    p1: selectFighter(p1),
    p2: selectFighter(p2)
  };
}
