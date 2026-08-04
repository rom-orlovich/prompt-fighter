/**
 * Pure geometry-plan builder for a fighter rig.
 *
 * Turns a `FighterVisual` (roster/visuals.ts) into a flat list of named,
 * positioned, sized parts — no Three.js, no DOM. `src/render/fighter.ts` is
 * the only place that reads this plan and actually instantiates Three.js
 * meshes from it, so this module stays runnable under plain Node/Vitest.
 */

import type { FighterVisual, HeadShape } from '../roster/visuals';

export type GeometryKind = 'box' | 'sphere' | 'octahedron' | 'torus' | 'plane';

export interface GeometrySpec {
  kind: GeometryKind;
  /**
   * Parameters, meaning depends on `kind`:
   *  - box / plane -> [width, height, depth?]  (plane has no depth)
   *  - sphere / octahedron -> [radius]
   *  - torus -> [radius, tube]
   */
  size: number[];
}

export type PartRole =
  | 'torso'
  | 'shoulders'
  | 'hips'
  | 'armLead'
  | 'armRear'
  | 'legLead'
  | 'legRear'
  | 'fistLead'
  | 'fistRear'
  | 'footLead'
  | 'footRear'
  | 'neck'
  | 'bezel'
  | 'screen'
  | 'head'
  | 'crest';

export type MaterialRole = 'body' | 'limb' | 'fist' | 'bezel' | 'head' | 'screen';

export interface FighterPart {
  name: string;
  role: PartRole;
  geometry: GeometrySpec;
  /** Local-space position relative to this part's natural parent (body group or head group). */
  position: [number, number, number];
  material: MaterialRole;
}

export type FighterPlan = FighterPart[];

/** The primitive each head shape is built from — the part with role `'head'`. */
export const HEAD_GEOMETRY: Record<HeadShape, GeometryKind> = {
  box: 'box',
  slabs: 'box',
  crest: 'octahedron',
  sphere: 'sphere'
};

const BASE_TORSO_HEIGHT = 1.3;

function headParts(visual: FighterVisual, headRadius: number): FighterPart[] {
  switch (visual.headShape) {
    case 'sphere':
      return [
        {
          name: 'head',
          role: 'head',
          geometry: { kind: 'sphere', size: [headRadius * 0.72] },
          position: [0, 0, -0.05],
          material: 'head'
        }
      ];
    case 'box':
      return [
        {
          name: 'head',
          role: 'head',
          geometry: { kind: 'box', size: [headRadius * 1.3, headRadius * 1.0, headRadius * 0.85] },
          position: [0, 0, -0.05],
          material: 'head'
        }
      ];
    case 'slabs': {
      const slabSize: [number, number, number] = [headRadius * 1.25, headRadius * 0.32, headRadius * 0.78];
      const offsets = [-0.28, 0, 0.28];
      return offsets.map((offset, i) => ({
        name: `headSlab${i}`,
        role: 'head',
        geometry: { kind: 'box', size: slabSize },
        position: [0, offset * headRadius, -0.05],
        material: 'head'
      }));
    }
    case 'crest':
      return [
        {
          name: 'head',
          role: 'head',
          geometry: { kind: 'octahedron', size: [headRadius * 0.85] },
          position: [0, 0, -0.05],
          material: 'head'
        },
        {
          name: 'crest',
          role: 'crest',
          geometry: { kind: 'torus', size: [headRadius * 0.95, headRadius * 0.12] },
          position: [0, headRadius * 0.55, -0.05],
          material: 'head'
        }
      ];
  }
}

export function buildFighterPlan(visual: FighterVisual): FighterPlan {
  const [tw, th, td] = visual.torso;
  const unit = th / BASE_TORSO_HEIGHT;
  const headRadius = tw * 0.95;

  // `fighter.ts`'s per-frame update() re-anchors torso/shoulders to these exact fixed
  // Y values every frame (it is kept byte-for-byte unchanged, see plan 2.4) — so a
  // unit-scaled initial Y here would just be silently overwritten one frame later.
  // Keep them literal to say what actually renders. Hips/neck are never touched by
  // update(), so their unit-scaled offset is the real, lasting position.
  const hipsY = 0.82 * unit;
  const torsoY = 1.5;
  const shouldersY = 2.05;
  const neckOffsetY = -0.9 * unit;

  const screenW = 2.15 * (visual.screenSize[0] / 640);
  const screenH = 1.34 * (visual.screenSize[1] / 400);

  const body: FighterPart[] = [
    {
      name: 'torso',
      role: 'torso',
      geometry: { kind: 'box', size: [tw, th, td] },
      position: [0, torsoY, 0],
      material: 'body'
    },
    {
      name: 'shoulders',
      role: 'shoulders',
      geometry: { kind: 'box', size: [visual.shoulderWidth, 0.34 * unit, td * 1.26] },
      position: [0, shouldersY, 0],
      material: 'limb'
    },
    {
      name: 'hips',
      role: 'hips',
      geometry: { kind: 'box', size: [visual.hipWidth, 0.46 * unit, td * 0.93] },
      position: [0, hipsY, 0],
      material: 'limb'
    },
    {
      name: 'armLead',
      role: 'armLead',
      geometry: { kind: 'box', size: [visual.limbThickness, visual.limbThickness, 1] },
      position: [0, 0, 0],
      material: 'limb'
    },
    {
      name: 'armRear',
      role: 'armRear',
      geometry: { kind: 'box', size: [visual.limbThickness * 0.9, visual.limbThickness * 0.9, 1] },
      position: [0, 0, 0],
      material: 'limb'
    },
    {
      name: 'legLead',
      role: 'legLead',
      geometry: { kind: 'box', size: [visual.limbThickness * 1.25, visual.limbThickness * 1.25, 1] },
      position: [0, 0, 0],
      material: 'limb'
    },
    {
      name: 'legRear',
      role: 'legRear',
      geometry: { kind: 'box', size: [visual.limbThickness * 1.25, visual.limbThickness * 1.25, 1] },
      position: [0, 0, 0],
      material: 'limb'
    },
    {
      name: 'fistLead',
      role: 'fistLead',
      geometry: { kind: 'box', size: [visual.limbThickness * 2.7, visual.limbThickness * 2.7, visual.limbThickness * 2.7] },
      position: [0, 0, 0],
      material: 'fist'
    },
    {
      name: 'fistRear',
      role: 'fistRear',
      geometry: { kind: 'box', size: [visual.limbThickness * 2.3, visual.limbThickness * 2.3, visual.limbThickness * 2.3] },
      position: [0, 0, 0],
      material: 'fist'
    },
    {
      name: 'footLead',
      role: 'footLead',
      geometry: { kind: 'box', size: [visual.footSize[0], 0.22 * unit, visual.footSize[1]] },
      position: [0, 0, 0],
      material: 'limb'
    },
    {
      name: 'footRear',
      role: 'footRear',
      geometry: { kind: 'box', size: [visual.footSize[0], 0.22 * unit, visual.footSize[1]] },
      position: [0, 0, 0],
      material: 'limb'
    }
  ];

  const head: FighterPart[] = [
    {
      name: 'screen',
      role: 'screen',
      geometry: { kind: 'plane', size: [screenW, screenH] },
      position: [0, 0, 0.14],
      material: 'screen'
    },
    {
      name: 'bezel',
      role: 'bezel',
      geometry: { kind: 'box', size: [screenW + 0.21, screenH + 0.22, 0.26] },
      position: [0, 0, 0],
      material: 'bezel'
    },
    {
      name: 'neck',
      role: 'neck',
      geometry: { kind: 'box', size: [visual.limbThickness * 0.84, 0.5 * unit, visual.limbThickness * 0.84] },
      position: [0, neckOffsetY, 0],
      material: 'limb'
    },
    ...headParts(visual, headRadius)
  ];

  return [...body, ...head];
}

/** A short deterministic string that is unique per distinct plan — used only by tests. */
export function planSignature(plan: FighterPlan): string {
  return plan
    .map(
      (p) =>
        `${p.name}:${p.role}:${p.material}:${p.geometry.kind}:${p.geometry.size.join(',')}:${p.position.join(',')}`
    )
    .join('|');
}
