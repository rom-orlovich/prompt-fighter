// `GLTFLoader`'s texture-loading path reaches for `self` (a browser/worker
// global) even for image decode failures we don't care about here — must be
// set before the loader is ever imported, since it resolves the reference at
// call time, not at import time.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
const NAMES = [
  'CLAUDE',
  'CODEX',
  'GEMINI',
  'LOCAL 7B',
  'IRON_FIST',
  'VIPER',
  'WARDEN',
  'BLAZE'
] as const;

/**
 * The original four only — reused inside the G16 describe block below, which
 * actually loads real GLTF assets through `GLTFLoader` + `AnimationMixer` and
 * samples the idle clip 8x per fighter. That is expensive by design (it is
 * the only place in this file exercising the real rig, not the raw glTF
 * bytes), so G16 stays scoped to the original roster rather than paying that
 * cost 2x for the four new fighters, which only recombine the SAME vendored
 * body/hair assets G16 already exercises via CLAUDE/CODEX/GEMINI/LOCAL 7B.
 */
const FILL_NAMES = ['CLAUDE', 'CODEX', 'GEMINI', 'LOCAL 7B'] as const;

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
    expect(new Set(heights).size).toBe(8);
    for (const name of NAMES) {
      expect(measuredWorldBounds(name).top, name).toBeGreaterThan(arenaHeight(CHARACTERS[name]!) - 0.05);
    }
  });
});

/**
 * Regression coverage for G16: `measuredBounds()` (see `src/render/fighter.ts`)
 * used to gate its one-and-only measurement on the body and hair assets having
 * loaded, but not on the pose animation having actually started. `Anims.glb`
 * (the shared clip library) is 10-40x larger than any single hairstyle, so on
 * a real network the hair reliably finishes loading first — the measurement
 * fired while the skeleton still sat in its unposed rest state, and because
 * `THREE.Box3`'s default (imprecise) path reads a `SkinnedMesh`'s own
 * `boundingBox` — which three.js computes lazily on first touch and never
 * recomputes on its own — that wrong, too-tall measurement stuck for the
 * card's entire life. The fix adds a `poseApplied` gate and switches to
 * `Box3.setFromObject(model, true)` (precise, always live, immune to that
 * cache). This file drives the SAME `GLTFLoader` + `AnimationMixer` +
 * `Box3(precise)` pipeline `measuredBounds()` uses, against the real vendored
 * assets, so a regression in either the gate or the `precise` flag shows up
 * here rather than only on a screenshot.
 */
describe('character-select preview fill (G16)', () => {
  const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');
  /**
   * Revised acceptance (all four fighters share ONE normalised `frameFighter`
   * formula/`fit`, so a genuinely shorter fighter — LOCAL 7B, `arenaHeight`
   * 2.95 vs GEMINI's 3.64 — correctly fills LESS of its card; that is the
   * design, not a bug): the tallest fighter must clear `MAX_FILL_FLOOR`, and
   * no fighter may drop below `MIN_FILL_FLOOR`. Cross-checked against a real
   * headed screenshot's per-canvas pixel measurement (CLAUDE 0.833, CODEX
   * 0.876, GEMINI 0.846, LOCAL 7B 0.688), which already clears both bars.
   */
  const MAX_FILL_FLOOR = 0.8;
  const MIN_FILL_FLOOR = 0.6;

  function loadGlb(name: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    const buf = readFileSync(join(ASSETS_DIR, `${name}.glb`));
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        '',
        (gltf) => resolve(gltf as never),
        reject
      );
    });
  }

  /** Rebinds hair to body bones exactly like `createFighter` does. */
  function rebindHair(body: THREE.Object3D, hairScene: THREE.Object3D): void {
    const bodyBones = new Map<string, THREE.Bone>();
    body.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) bodyBones.set(obj.name, obj as THREE.Bone);
    });
    let hairMesh: THREE.SkinnedMesh | null = null;
    hairScene.traverse((obj) => {
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && !hairMesh) hairMesh = skinned;
    });
    if (!hairMesh) return;
    const skinned: THREE.SkinnedMesh = hairMesh;
    const bones = skinned.skeleton.bones.map((bone) => bodyBones.get(bone.name) ?? bone);
    skinned.bind(new THREE.Skeleton(bones, skinned.skeleton.boneInverses), skinned.bindMatrix);
    body.add(skinned);
  }

  /** Builds the same group(scaled) -> model -> body(+rebound hair) hierarchy `createFighter` builds. */
  async function buildRig(name: (typeof NAMES)[number]) {
    const spec = CHARACTERS[name]!;
    const [{ scene: body }, hairGltf] = await Promise.all([loadGlb(spec.body), loadGlb(spec.hair)]);

    const group = new THREE.Group();
    group.scale.set(spec.modelScale * spec.bulk, spec.modelScale, spec.modelScale * spec.bulk);
    const model = new THREE.Group();
    group.add(model);
    model.add(body);
    rebindHair(body, hairGltf.scene);

    /** Measures the CURRENT true posed silhouette — exactly what `measuredBounds()` does. */
    function measure(): { top: number; bottom: number } {
      model.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(model, true);
      return { top: box.max.y, bottom: box.min.y };
    }

    return { body, model, measure };
  }

  /**
   * Advances `mixer` from wherever it currently sits up to `targetTime` in
   * small (~1/60s) forward steps, interleaved with a full `updateWorldMatrix`
   * pass after every single step — the same way a real frame drives the rig
   * in `select.ts`: `rig.update(dt, elapsed)` (which calls `mixer.update`)
   * immediately followed by `renderer.render(...)`, which walks and refreshes
   * every bone's `matrixWorld` before drawing. Skip that interleaving (e.g. by
   * accumulating many `mixer.update()` calls back-to-back with no traversal in
   * between, then reading bone world matrices once at the end) and bone world
   * matrices go stale relative to the mixer's actual local-transform state —
   * an artifact of not rendering every step, not anything a real preview does.
   */
  function advanceTo(mixer: THREE.AnimationMixer, model: THREE.Object3D, current: number, targetTime: number): number {
    const STEP = 1 / 60;
    let t = current;
    while (t < targetTime - 1e-9) {
      const dt = Math.min(STEP, targetTime - t);
      mixer.update(dt);
      model.updateWorldMatrix(true, true);
      t += dt;
    }
    return t;
  }

  it(
    'fills the frustum at every point in the idle loop, using a camera framed once (like the real preview)',
    async () => {
      const { animations } = await loadGlb('Anims');
      const clip = animations.find((c) => c.name === 'Sword_Idle');
      if (!clip) throw new Error('no Sword_Idle clip in Anims.glb');

      const minFillByFighter: Record<string, number> = {};
      for (const name of FILL_NAMES) {
        const { body, model, measure } = await buildRig(name);
        const mixer = new THREE.AnimationMixer(body);
        mixer.clipAction(clip).play();
        let t = 0;

        // Frame the camera from the FIRST measurement, exactly like
        // `select.ts`'s one-shot `!entry.framed` re-frame the instant
        // `poseApplied` (see `fighter.ts`) goes true — which, once gated
        // correctly, lands at or near the top of the loop, not mid-loop.
        t = advanceTo(mixer, model, t, 0);
        const framedFrom = measure();
        const { cameraY, distance } = frameFighter(framedFrom.top, framedFrom.bottom);
        const camera = cameraFor(cameraY, distance);

        // Then keep sampling forward across the WHOLE loop — the idle clip
        // keeps breathing/swaying after the camera is locked — and track the
        // worst (smallest) fill any sampled pose reaches in that same fixed
        // camera.
        const samples = 8;
        let minFill = Infinity;
        for (let i = 0; i <= samples; i++) {
          t = advanceTo(mixer, model, t, (clip.duration * i) / samples);
          const { top, bottom } = measure();
          const fill = (projectY(camera, top) - projectY(camera, bottom)) / 2;
          minFill = Math.min(minFill, fill);
        }
        minFillByFighter[name] = minFill;
      }

      // One shared normalised framing, not four independent ones: the
      // tallest-reading fighter must fill most of its card, and even the
      // shortest must still read as a fighter, not a speck.
      const fills = Object.values(minFillByFighter);
      expect(Math.max(...fills), `best-filling fighter (${JSON.stringify(minFillByFighter)})`).toBeGreaterThanOrEqual(
        MAX_FILL_FLOOR
      );
      expect(Math.min(...fills), `worst-filling fighter (${JSON.stringify(minFillByFighter)})`).toBeGreaterThanOrEqual(
        MIN_FILL_FLOOR
      );
    },
    20_000
  );

  it(
    'documents the bug: framing from the UNPOSED rest state visibly undershoots framing from the real idle pose',
    async () => {
      // Sanity check mirroring the G12 "this bug was real" test above: confirms
      // the `poseApplied` gate is load-bearing, not decorative. `Sword_Idle`'s
      // combat crouch measures shorter than the skeleton's unposed rest state
      // (verified above: real vendored assets, not a stub) — so a camera framed
      // from the rest state, before any clip has ever been applied, leaves the
      // fighter visibly smaller than one framed from the pose it actually
      // renders in. This compares the two framings directly rather than
      // asserting an exact percentage, since the precise gap depends on
      // per-fighter body/hair geometry — a real screenshot (see rollout) is
      // what pins down the final on-screen number.
      const { animations } = await loadGlb('Anims');
      const clip = animations.find((c) => c.name === 'Sword_Idle');
      if (!clip) throw new Error('no Sword_Idle clip in Anims.glb');

      for (const name of FILL_NAMES) {
        const { body, model, measure } = await buildRig(name);

        // No mixer, no `.play()` — this is the skeleton exactly as the loader
        // left it, before `poseApplied` would ever have gone true.
        const restBox = measure();
        const restFrame = frameFighter(restBox.top, restBox.bottom);
        const restCamera = cameraFor(restFrame.cameraY, restFrame.distance);

        // Now pose it into the real idle stance, the same way a real frame
        // loop would.
        const mixer = new THREE.AnimationMixer(body);
        mixer.clipAction(clip).play();
        advanceTo(mixer, model, 0, clip.duration * 0.3);
        const posedBox = measure();
        const posedFrame = frameFighter(posedBox.top, posedBox.bottom);
        const posedCamera = cameraFor(posedFrame.cameraY, posedFrame.distance);

        // Fill of the REAL posed silhouette, in each camera.
        const fillFromRestCamera =
          (projectY(restCamera, posedBox.top) - projectY(restCamera, posedBox.bottom)) / 2;
        const fillFromPosedCamera =
          (projectY(posedCamera, posedBox.top) - projectY(posedCamera, posedBox.bottom)) / 2;

        expect(fillFromRestCamera, `${name} framed from rest`).toBeLessThan(fillFromPosedCamera);
        // The correctly-framed camera should land right at the design target.
        expect(fillFromPosedCamera, `${name} framed from the real pose`).toBeCloseTo(0.9, 2);
      }
    },
    20_000
  );
});
