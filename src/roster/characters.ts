/**
 * Per-fighter character spec.
 *
 * A `CharacterSpec` is pure data: no Three.js, no DOM. Each fighter is a
 * combination of a vendored body mesh, a hairstyle rigged to the same skeleton,
 * a brand tint, a height and a build — every part CC0 (Quaternius).
 *
 * The free tier of the base-character pack ships two bodies, so identity comes
 * from the combination rather than from four separate meshes: two bodies × four
 * distinct hairstyles × per-fighter height/build/tint. That is a real step up
 * from the previous single shared mesh, and short of four wholly different
 * characters (the pack's paid tier has eight bodies).
 *
 * Kept dependency-free so it can be unit-tested under plain Node/Vitest with no
 * browser, exactly like `src/roster/visuals.ts`.
 */

/** Vendored body meshes. */
export type BodyId = 'Male' | 'Female';

/** Vendored hairstyles, rigged to the shared skeleton's head bone. */
export type HairId = 'Hair_SimpleParted' | 'Hair_Beard' | 'Hair_Buzzed' | 'Hair_Long';

export const BODIES: readonly BodyId[] = ['Male', 'Female'];
export const HAIRSTYLES: readonly HairId[] = [
  'Hair_SimpleParted',
  'Hair_Beard',
  'Hair_Buzzed',
  'Hair_Long'
];

/** The shared clip library every body is animated by. */
export const ANIMATION_ASSET = 'Anims';

/** Natural heights of the vendored bodies, measured from their bounding boxes. */
const BODY_HEIGHT: Record<BodyId, number> = {
  Male: 1.82,
  Female: 1.78
};

export interface CharacterSpec {
  /** Display name, mirrors the roster key. */
  name: string;
  /** Vendored body mesh this fighter wears. */
  body: BodyId;
  /** Vendored hairstyle — unique per fighter, the main silhouette cue at the head. */
  hair: HairId;
  /** One-line description — must be unique per fighter. */
  description: string;
  /** Skin tint applied to the body — MUST equal `ROSTER[name].color`. */
  skin: number;
  /** Uniform height scale, so `arenaHeight` lands in the band the camera frames. */
  modelScale: number;
  /**
   * Width/depth multiplier layered on top of `modelScale`. Kept mild
   * (0.9-1.15) — a skinned humanoid stretched much past that reads as broken
   * rather than heavyset.
   */
  bulk: number;
}

/** The body's own height in world units, before scaling. */
export function modelHeight(spec: CharacterSpec): number {
  return BODY_HEIGHT[spec.body];
}

/**
 * How tall this fighter actually stands in the arena. The procedural rig this
 * all replaced put its head at y=3.12, so the camera is framed for roughly this
 * range — a pass at double it cropped every fighter at the waist on screen.
 */
export function arenaHeight(spec: CharacterSpec): number {
  return modelHeight(spec) * spec.modelScale;
}

export const CHARACTERS: Record<string, CharacterSpec> = {
  CLAUDE: {
    name: 'CLAUDE',
    body: 'Male',
    hair: 'Hair_SimpleParted',
    description: 'a measured counter-puncher, lean and deliberate',
    skin: 0xd97757,
    modelScale: 1.79,
    bulk: 0.97
  },
  CODEX: {
    name: 'CODEX',
    body: 'Male',
    hair: 'Hair_Beard',
    description: 'a bearded front-foot brawler that commits to every swing',
    skin: 0x10a37f,
    modelScale: 1.87,
    bulk: 1.1
  },
  GEMINI: {
    name: 'GEMINI',
    body: 'Male',
    hair: 'Hair_Buzzed',
    description: 'a shaven-headed heavyweight that overwhelms with sheer reach',
    skin: 0x4285f4,
    modelScale: 2.0,
    bulk: 1.15
  },
  'LOCAL 7B': {
    name: 'LOCAL 7B',
    body: 'Female',
    hair: 'Hair_Long',
    description: 'a compact featherweight — fast hands, shallow reads',
    skin: 0xa855f7,
    modelScale: 1.66,
    bulk: 0.9
  },
  IRON_FIST: {
    name: 'IRON_FIST',
    body: 'Female',
    hair: 'Hair_SimpleParted',
    description: 'an armored grappler that shrugs off punishment and closes the distance',
    skin: 0x8c8c9a,
    modelScale: 1.95,
    bulk: 1.05
  },
  VIPER: {
    name: 'VIPER',
    body: 'Female',
    hair: 'Hair_Beard',
    description: 'a venomous counter-striker that waits for one clean opening',
    skin: 0x76b900,
    modelScale: 1.72,
    bulk: 0.93
  },
  WARDEN: {
    name: 'WARDEN',
    body: 'Female',
    hair: 'Hair_Buzzed',
    description: 'a stoic wall of a fighter built to absorb and outlast',
    skin: 0x2c3e91,
    modelScale: 2.05,
    bulk: 1.2
  },
  BLAZE: {
    name: 'BLAZE',
    body: 'Male',
    hair: 'Hair_Long',
    description: 'a relentless pressure fighter that never lets the pace cool',
    skin: 0xff4500,
    modelScale: 1.95,
    bulk: 1.08
  }
};

const FALLBACK_CHARACTER: Omit<CharacterSpec, 'name'> = {
  body: 'Male',
  hair: 'Hair_Buzzed',
  description: 'an unlabeled contender, plain and unknown',
  skin: 0x8899aa,
  modelScale: 1.82,
  bulk: 1
};

export function characterFor(name: string): CharacterSpec {
  const known = CHARACTERS[name];
  if (known) return known;
  return { ...FALLBACK_CHARACTER, name };
}

/** A short deterministic string that is unique per distinct spec — used only by tests. */
export function characterSignature(spec: CharacterSpec): string {
  return [spec.name, spec.body, spec.hair, spec.description, spec.skin, spec.modelScale, spec.bulk].join(
    '|'
  );
}

/** Resolves a vendored asset id to its local, same-origin `.glb` path under the app base. */
export function characterAssetUrl(asset: string, base = '/'): string {
  return `${base}assets/characters/${asset}.glb`;
}
