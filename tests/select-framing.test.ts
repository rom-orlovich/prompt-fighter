import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { readGlb } from '../scripts/gltf-to-glb.mjs';
import { CHARACTERS, arenaHeight } from '../src/roster/characters';
import { frameFighter } from '../src/render/select';

/**
 * Regression coverage for G12: the character-select preview camera used to be
 * a hard-coded `PerspectiveCamera` position that framed a fixed world-Y band —
 * fine when it was tuned, silently wrong the moment a fighter's height moved
 * (three of the four roster fighters ended up taller than the band and had
 * their heads cropped at the top of the card). `frameFighter` replaces that
 * with a camera solved from each fighter's OWN measured height, so this test
 * measures real vendored geometry rather than asserting against a constant —
 * a future rescale keeps passing (that is the self-correcting design, see
 * `select.ts`), but a broken formula, a forgotten hairstyle, or a camera that
 * silently drifts back to a fixed frame all show up here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');
const NAMES = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'] as const;

const PREVIEW_ASPECT = 220 / 280;

/**
 * Real, measured vertical extent of a vendored asset's meshes, straight from
 * the glTF `POSITION` accessor `min`/`max` — the same bind-pose bounding data
 * `THREE.Box3.setFromObject` reads off the loaded geometry at runtime (see
 * `measuredBounds()` in `src/render/fighter.ts`), just read directly off disk
 * instead of through a full GLTFLoader/WebGL round trip.
 */
function assetVerticalExtent(asset: string): { top: number; bottom: number } {
  const glb = readFileSync(join(ASSETS_DIR, `${asset}.glb`));
  const { json } = readGlb(new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength));
  let top = -Infinity;
  let bottom = Infinity;
  for (const mesh of (json as any).meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = (json as any).accessors[primitive.attributes.POSITION];
      if (!accessor?.max || !accessor?.min) continue;
      top = Math.max(top, accessor.max[1]);
      bottom = Math.min(bottom, accessor.min[1]);
    }
  }
  return { top, bottom };
}

/** A fighter's real world-space height band: body + hair, scaled by `modelScale`. */
function measuredWorldBounds(name: (typeof NAMES)[number]): { top: number; bottom: number } {
  const spec = CHARACTERS[name]!;
  const body = assetVerticalExtent(spec.body);
  const hair = assetVerticalExtent(spec.hair);
  return {
    top: Math.max(body.top, hair.top) * spec.modelScale,
    bottom: Math.min(body.bottom, hair.bottom) * spec.modelScale
  };
}

/** Projects a world-Y point straight ahead of `camera` into NDC, via a real
 * `THREE.PerspectiveCamera` projection matrix — not the formula under test. */
function projectY(camera: THREE.PerspectiveCamera, y: number): number {
  return new THREE.Vector3(0, y, 0).project(camera).y;
}

function cameraFor(cameraY: number, distance: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(40, PREVIEW_ASPECT, 0.1, 30);
  camera.position.set(0, cameraY, distance);
  camera.lookAt(0, cameraY, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe('character-select preview framing (G12)', () => {
  it('keeps every fighter taller than the old fixed band (sanity: this bug was real)', () => {
    // The old camera — position (0, 1.9, 4.6), lookAt (0, 1.55, 0) — framed a
    // fixed vertical band regardless of the fighter. Confirms the premise: with
    // that fixed camera, at least one roster fighter's head lands outside the
    // frustum (NDC > 1), which is the cropping the operator reported.
    const oldCamera = new THREE.PerspectiveCamera(40, PREVIEW_ASPECT, 0.1, 30);
    oldCamera.position.set(0, 1.9, 4.6);
    oldCamera.lookAt(0, 1.55, 0);
    oldCamera.updateMatrixWorld(true);
    oldCamera.updateProjectionMatrix();

    const overshoots = NAMES.map((name) => projectY(oldCamera, measuredWorldBounds(name).top) > 1);
    expect(overshoots.some(Boolean), 'at least one fighter must have been cropped by the old camera').toBe(
      true
    );
  });

  it('fits every fighter — head (with hair) and feet — inside the frustum with margin', () => {
    for (const name of NAMES) {
      const { top, bottom } = measuredWorldBounds(name);
      const { cameraY, distance } = frameFighter(top, bottom);
      const camera = cameraFor(cameraY, distance);

      const topNdc = projectY(camera, top);
      const bottomNdc = projectY(camera, bottom);

      expect(topNdc, `${name} head NDC`).toBeLessThanOrEqual(0.92);
      expect(bottomNdc, `${name} feet NDC`).toBeGreaterThanOrEqual(-0.95);
      // Not just "inside frame" — inside with room to spare, or a rescale that
      // eats the margin would pass right up to the edge undetected.
      expect(topNdc, `${name} head NDC should clear the top edge`).toBeLessThan(1);
      expect(bottomNdc, `${name} feet NDC should clear the bottom edge`).toBeGreaterThan(-1);
    }
  });

  it('normalises all four fighters to read at a comparable on-screen size', () => {
    const spans = NAMES.map((name) => {
      const { top, bottom } = measuredWorldBounds(name);
      const { cameraY, distance } = frameFighter(top, bottom);
      const camera = cameraFor(cameraY, distance);
      return projectY(camera, top) - projectY(camera, bottom);
    });
    const [first, ...rest] = spans;
    for (const span of rest) expect(span).toBeCloseTo(first!, 6);
  });

  it('keeps every fighter within a sane camera distance for the preview clip range', () => {
    for (const name of NAMES) {
      const { top, bottom } = measuredWorldBounds(name);
      const { distance } = frameFighter(top, bottom);
      expect(distance, name).toBeGreaterThan(0.1);
      expect(distance, name).toBeLessThan(30);
    }
  });

  it('measures real, distinct heights across the roster (not a stubbed constant)', () => {
    // If this ever collapsed to one shared number the rest of this file would
    // be testing a fixture, not the roster. And it should land near (not
    // necessarily above — a hairstyle isn't guaranteed to crest above the
    // head mesh, e.g. a beard) `arenaHeight`'s body-only figure, confirming
    // this is the same fighter's real geometry, not an unrelated number.
    const heights = NAMES.map((name) => {
      const { top, bottom } = measuredWorldBounds(name);
      return top - bottom;
    });
    expect(new Set(heights).size).toBe(4);
    for (const name of NAMES) {
      expect(measuredWorldBounds(name).top, name).toBeGreaterThan(arenaHeight(CHARACTERS[name]!) - 0.05);
    }
  });
});
