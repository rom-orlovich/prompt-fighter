/**
 * Per-fighter character spec.
 *
 * A `CharacterSpec` is pure data: no Three.js, no DOM. Every fighter now wears
 * the *same* realistically-proportioned humanoid rig (Quaternius, CC0) — the
 * roster's earlier KayKit models were four visibly different characters, but
 * they were chibi fantasy adventurers, which read nothing like a fistfight.
 *
 * Sharing one rig means silhouette variety has to come from somewhere else, so
 * each fighter gets its own brand tint, its own `modelScale` (height) and its
 * own `bulk` (width/depth). A hulking GEMINI and a compact LOCAL 7B still read
 * apart at a glance, they are just no longer different *characters*.
 *
 * Kept dependency-free so it can be unit-tested under plain Node/Vitest with no
 * browser, exactly like `src/roster/visuals.ts`.
 */

/** The single vendored fighter rig. Every roster entry uses it. */
export type CharacterModelId = 'Fighter';

export const CHARACTER_MODEL: CharacterModelId = 'Fighter';

/** Natural height of the vendored rig, measured from its bounding box in the guard stance. */
export const RIG_NATURAL_HEIGHT = 1.83;

export interface CharacterSpec {
  /** Display name, mirrors the roster key. */
  name: string;
  /** Vendored rig this fighter wears — currently always `Fighter`. */
  model: CharacterModelId;
  /** One-line description — must be unique per fighter. */
  description: string;
  /** Skin tint applied to the rig — MUST equal `ROSTER[name].color`. */
  skin: number;
  /** The rig's own height in world units, before scaling. */
  modelHeight: number;
  /** Uniform height scale, so `arenaHeight` lands in the band the camera frames. */
  modelScale: number;
  /**
   * Width/depth multiplier layered on top of `modelScale`. This is the only
   * knob that separates a stocky fighter from a lean one now that all four
   * share a mesh — kept mild (0.9-1.15) because a skinned humanoid stretched
   * much past that starts to read as broken rather than heavyset.
   */
  bulk: number;
}

/**
 * How tall this fighter actually stands in the arena. The procedural rig this
 * all replaced put its head at y=3.12, so the camera is framed for roughly this
 * range — a pass at double it cropped every fighter at the waist on screen.
 */
export function arenaHeight(spec: CharacterSpec): number {
  return spec.modelHeight * spec.modelScale;
}

export const CHARACTERS: Record<string, CharacterSpec> = {
  CLAUDE: {
    name: 'CLAUDE',
    model: 'Fighter',
    description: 'a measured counter-puncher, lean and deliberate',
    skin: 0xd97757,
    modelHeight: RIG_NATURAL_HEIGHT,
    modelScale: 1.78,
    bulk: 0.97
  },
  CODEX: {
    name: 'CODEX',
    model: 'Fighter',
    description: 'a front-foot brawler that commits to every swing',
    skin: 0x10a37f,
    modelHeight: RIG_NATURAL_HEIGHT,
    modelScale: 1.86,
    bulk: 1.1
  },
  GEMINI: {
    name: 'GEMINI',
    model: 'Fighter',
    description: 'a hulking heavyweight that overwhelms with sheer reach',
    skin: 0x4285f4,
    modelHeight: RIG_NATURAL_HEIGHT,
    modelScale: 2.0,
    bulk: 1.15
  },
  'LOCAL 7B': {
    name: 'LOCAL 7B',
    model: 'Fighter',
    description: 'a compact featherweight — fast hands, shallow reads',
    skin: 0xa855f7,
    modelHeight: RIG_NATURAL_HEIGHT,
    modelScale: 1.61,
    bulk: 0.9
  }
};

const FALLBACK_CHARACTER: Omit<CharacterSpec, 'name'> = {
  model: 'Fighter',
  description: 'an unlabeled contender, plain and unknown',
  skin: 0x8899aa,
  modelHeight: RIG_NATURAL_HEIGHT,
  modelScale: 1.8,
  bulk: 1
};

export function characterFor(name: string): CharacterSpec {
  const known = CHARACTERS[name];
  if (known) return known;
  return { ...FALLBACK_CHARACTER, name };
}

/** A short deterministic string that is unique per distinct spec — used only by tests. */
export function characterSignature(spec: CharacterSpec): string {
  return [spec.name, spec.model, spec.description, spec.skin, spec.modelScale, spec.bulk].join('|');
}

/** Resolves a vendored model id to its local, same-origin `.glb` path under the app base. */
export function characterAssetUrl(model: CharacterModelId, base = '/'): string {
  return `${base}assets/characters/${model}.glb`;
}
