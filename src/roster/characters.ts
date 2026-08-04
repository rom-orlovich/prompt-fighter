/**
 * Per-fighter character asset spec.
 *
 * A `CharacterSpec` is pure data: no Three.js, no DOM. It maps each roster
 * fighter directly onto one of the four vendored KayKit character models —
 * no body/hairstyle recombination, since that model never matched the real
 * vendored assets. Kept dependency-free so it can be unit-tested under
 * plain Node/Vitest with no browser, exactly like `src/roster/visuals.ts`.
 */

/** The four vendored KayKit character models. */
export type CharacterModelId = 'Barbarian' | 'Knight' | 'Mage' | 'Rogue';

/** All vendored KayKit character models — one per fighter, no repeats. */
export const CHARACTER_MODELS: readonly CharacterModelId[] = ['Barbarian', 'Knight', 'Mage', 'Rogue'];

export interface CharacterSpec {
  /** Display name, mirrors the roster key. */
  name: string;
  /** Vendored KayKit model this fighter wears. */
  model: CharacterModelId;
  /** One-line description — must be unique per fighter. */
  description: string;
  /** Skin tint applied to the model — MUST equal `ROSTER[name].color`. */
  skin: number;
  /**
   * The vendored model's own height in world units, measured from its bounding
   * box in the Idle pose. Recorded here so `modelScale` reads as a derivation
   * rather than a magic number: `arenaHeight(spec)` is what actually has to land
   * in the arena's band, and the two models differ enough (2.37 to 2.98) that a
   * shared scale would size them wildly differently on screen.
   */
  modelHeight: number;
  /** Uniform scale applied so the glTF model matches arena height. */
  modelScale: number;
}

/**
 * How tall this fighter actually stands in the arena. The old procedural rigs
 * put the head at y=3.12, so the camera is framed for roughly this range —
 * anything near double it fills the frame and crops at the waist.
 */
export function arenaHeight(spec: CharacterSpec): number {
  return spec.modelHeight * spec.modelScale;
}

export const CHARACTERS: Record<string, CharacterSpec> = {
  CLAUDE: {
    name: 'CLAUDE',
    model: 'Mage',
    description: 'a measured spellcaster, weighing every word before it casts',
    skin: 0xd97757,
    modelHeight: 2.976,
    modelScale: 1.09
  },
  CODEX: {
    name: 'CODEX',
    model: 'Knight',
    description: 'an armored knight that charges in fully certain, right or wrong',
    skin: 0x10a37f,
    modelHeight: 2.44,
    modelScale: 1.39
  },
  GEMINI: {
    name: 'GEMINI',
    model: 'Barbarian',
    description: 'a hulking barbarian that overwhelms the arena with sheer context',
    skin: 0x4285f4,
    modelHeight: 2.371,
    modelScale: 1.54
  },
  'LOCAL 7B': {
    name: 'LOCAL 7B',
    model: 'Rogue',
    description: 'a quick, lightweight rogue — fast strikes, shallow reads',
    skin: 0xa855f7,
    modelHeight: 2.585,
    modelScale: 1.14
  }
};

const FALLBACK_CHARACTER: Omit<CharacterSpec, 'name'> = {
  model: 'Knight',
  description: 'an unlabeled construct, plain and unknown',
  skin: 0x8899aa,
  modelHeight: 2.44,
  modelScale: 1.35
};

export function characterFor(name: string): CharacterSpec {
  const known = CHARACTERS[name];
  if (known) return known;
  return { ...FALLBACK_CHARACTER, name };
}

/** A short deterministic string that is unique per distinct spec — used only by tests. */
export function characterSignature(spec: CharacterSpec): string {
  return [spec.name, spec.model, spec.description, spec.skin, spec.modelHeight, spec.modelScale].join('|');
}

/** Resolves a vendored model id to its local, same-origin `.glb` path under the app base. */
export function characterAssetUrl(model: CharacterModelId, base = '/'): string {
  return `${base}assets/characters/${model}.glb`;
}
