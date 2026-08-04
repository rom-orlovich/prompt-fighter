/**
 * Procedural fighter visual specs.
 *
 * A `FighterVisual` is pure data: no Three.js, no DOM. It is the single source
 * of truth for how a fighter's silhouette differs from the others — head
 * shape, palette, scale and body proportions — so that `src/render/fighter-plan.ts`
 * (also pure) can turn it into a concrete part list, which `src/render/fighter.ts`
 * then turns into real Three.js geometry. Kept dependency-free so it can be
 * unit-tested under plain Node/Vitest with no browser.
 */

/** How the head reads at a glance — drives which primitive(s) `fighter-plan.ts` builds it from. */
export type HeadShape = 'box' | 'slabs' | 'crest' | 'sphere';

export interface FighterVisual {
  /** Display name, mirrors the roster key. */
  name: string;
  /** One-line silhouette description — never shown in-game, but must be unique per fighter. */
  silhouette: string;
  headShape: HeadShape;
  /** Uniform multiplier applied to the whole rig's root group. */
  scale: number;
  /** Base body colour (torso / shoulders / hips). */
  color: number;
  /** Limb + fist accent colour. */
  accent: number;
  /** Third colour, used for the head/crest shell so the head reads as its own material. */
  trim: number;
  /** Torso box dimensions: [width, height, depth]. */
  torso: [number, number, number];
  shoulderWidth: number;
  hipWidth: number;
  /** Cross-section thickness shared by arms and legs. */
  limbThickness: number;
  /** Foot box footprint: [width, depth]. */
  footSize: [number, number];
  /** CRT canvas texture resolution: [width, height] in pixels. */
  screenSize: [number, number];
}

export const FIGHTER_VISUALS: Record<string, FighterVisual> = {
  CLAUDE: {
    name: 'CLAUDE',
    silhouette: 'round-headed diplomat, warm and rounded',
    headShape: 'sphere',
    scale: 1,
    color: 0xd97757,
    accent: 0xffc7a8,
    trim: 0xffe4cf,
    torso: [0.78, 1.3, 1.05],
    shoulderWidth: 0.62,
    hipWidth: 0.72,
    limbThickness: 0.19,
    footSize: [0.66, 0.44],
    screenSize: [640, 400]
  },
  CODEX: {
    name: 'CODEX',
    silhouette: 'square-jawed block, broad and stocky',
    headShape: 'box',
    scale: 1.08,
    color: 0x10a37f,
    accent: 0x7df0cd,
    trim: 0x0b6b52,
    torso: [0.92, 1.22, 1.15],
    shoulderWidth: 0.78,
    hipWidth: 0.82,
    limbThickness: 0.23,
    footSize: [0.74, 0.5],
    screenSize: [704, 380]
  },
  GEMINI: {
    name: 'GEMINI',
    silhouette: 'crowned spire, tall and imposing',
    headShape: 'crest',
    scale: 1.15,
    color: 0x4285f4,
    accent: 0xa8c7ff,
    trim: 0xe8f0ff,
    torso: [0.7, 1.55, 0.95],
    shoulderWidth: 0.7,
    hipWidth: 0.6,
    limbThickness: 0.2,
    footSize: [0.6, 0.42],
    screenSize: [672, 456]
  },
  'LOCAL 7B': {
    name: 'LOCAL 7B',
    silhouette: 'stacked slab runt, compact and quick',
    headShape: 'slabs',
    scale: 0.86,
    color: 0xa855f7,
    accent: 0xe0bbff,
    trim: 0x5b21a6,
    torso: [0.6, 1.02, 0.8],
    shoulderWidth: 0.5,
    hipWidth: 0.56,
    limbThickness: 0.15,
    footSize: [0.5, 0.34],
    screenSize: [520, 320]
  }
};

const FALLBACK_VISUAL: FighterVisual = {
  name: '',
  silhouette: 'unlabeled construct, plain and unknown',
  headShape: 'box',
  scale: 1,
  color: 0x8899aa,
  accent: 0xccd6e0,
  trim: 0x556070,
  torso: [0.75, 1.25, 1.0],
  shoulderWidth: 0.6,
  hipWidth: 0.68,
  limbThickness: 0.18,
  footSize: [0.6, 0.4],
  screenSize: [600, 380]
};

export function visualFor(name: string): FighterVisual {
  const known = FIGHTER_VISUALS[name];
  if (known) return known;
  return { ...FALLBACK_VISUAL, name };
}

/** A short deterministic string that is unique per distinct visual — used only by tests. */
export function visualSignature(visual: FighterVisual): string {
  return [
    visual.headShape,
    visual.scale,
    visual.color,
    visual.accent,
    visual.trim,
    visual.torso.join(':'),
    visual.shoulderWidth,
    visual.hipWidth,
    visual.limbThickness,
    visual.footSize.join(':'),
    visual.screenSize.join(':'),
    visual.silhouette
  ].join('|');
}
