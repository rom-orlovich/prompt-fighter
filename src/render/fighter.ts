/**
 * A fighter is a real KayKit character model with a floating terminal-text
 * billboard hovering above its head.
 *
 * The model loads asynchronously through `GLTFLoader` and is driven by an
 * `AnimationMixer` against the pack's baked clips (see `POSE_CLIPS`), but
 * `createFighter()` itself stays synchronous: it returns a fully-formed
 * `FighterRig` immediately, and the loaded geometry/animations simply appear
 * inside `group` once the fetch resolves. Callers (`main.ts`, `select.ts`)
 * never know or care whether the model has finished loading yet.
 *
 * The billboard sprite reuses the original CRT canvas-texture logic — same
 * `paint()`/`wrap()` — but is now a `THREE.Sprite` (always faces the camera,
 * no manual yaw needed) repositioned every frame to float just above the
 * model's actual `head` bone, instead of being the fighter's head itself.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FighterProfile } from '../fighters';
import { characterFor, characterAssetUrl } from '../roster/characters';

export type PoseName = 'idle' | 'windup' | 'attack' | 'guard' | 'hurt' | 'ko' | 'win';

export interface FighterRig {
  group: THREE.Group;
  setPose(pose: PoseName): void;
  setScreenText(text: string): void;
  setCharge(value: number): void;
  flash(intensity: number): void;
  update(dt: number, elapsed: number): void;
  headPosition(): THREE.Vector3;
}

/**
 * Maps the rig's abstract pose vocabulary onto the vendored Quaternius clips.
 *
 * Poses with more than one clip **alternate** on each entry. Two punches and two
 * hit reactions is the single cheapest thing that stops a long exchange looking
 * like the same frame replayed: a fighter that answers every hit with the exact
 * same flinch reads as a puppet, one that alternates head/chest reactions reads
 * as taking a beating.
 */
const POSE_CLIPS: Record<PoseName, readonly string[]> = {
  // Held on its last frame, so the neutral pose IS the guard-up boxing stance
  // rather than a relaxed stand — `Idle_Loop` is kept vendored as the fallback.
  idle: ['Punch_Enter'],
  // `windup` fires at the start of every turn, so it is on screen more than any
  // other pose. It re-asserts the same fists-up stance, just tenser (see
  // POSE_TIME_SCALE) — an earlier pass used the rig's crouch here and it read as
  // the fighter squatting down rather than loading up a punch.
  windup: ['Punch_Enter'],
  attack: ['Punch_Jab', 'Punch_Cross'],
  // The crouch survives here: slipping under a punch is a real block, and unlike
  // windup this only fires on an actual blocked hit, so it stays brief.
  guard: ['Crouch_Idle_Loop'],
  hurt: ['Hit_Head', 'Hit_Chest'],
  ko: ['Death01'],
  win: ['Dance_Loop']
};

/** Poses that hold their final frame instead of looping. */
const CLAMP_POSES: ReadonlySet<PoseName> = new Set<PoseName>(['ko', 'idle', 'attack', 'hurt']);

/**
 * Per-pose crossfade, in seconds. A punch has to snap or it reads as a shove;
 * settling back to the guard can afford to breathe. One global blend time was
 * the main reason the old rig felt floaty.
 */
const POSE_BLEND: Record<PoseName, number> = {
  idle: 0.22,
  windup: 0.14,
  attack: 0.06,
  guard: 0.12,
  hurt: 0.05,
  ko: 0.12,
  win: 0.3
};

/**
 * Per-pose playback rate. `idle` and `windup` share `Punch_Enter` — the rig has
 * no separate "load up" clip — so tempo is what separates them: settling into
 * the guard reads slower than snapping back into it before a strike.
 */
const POSE_TIME_SCALE: Record<PoseName, number> = {
  idle: 0.85,
  windup: 1.4,
  attack: 1.15,
  guard: 0.7,
  hurt: 1.1,
  ko: 1,
  win: 1
};

/**
 * The vendored rig is authored facing +Z (verified by rendering it at 0, ±PI/2
 * and PI against a marker on the +X axis). A fighter must face its opponent
 * across the X axis, so the base turn is a quarter turn: p1 (on the left, side
 * -1) to +X, p2 to -X.
 */
const FACING_QUARTER = Math.PI / 2;

/**
 * ...but pure profile hides the guard and reads flat, so each fighter is turned
 * back toward the camera by this much for the classic 3/4 fighting-game view.
 */
const FACING_CAMERA_BIAS = 0.3;

/** Yaw that puts a fighter on `side` into a 3/4 stance facing its opponent. */
function facingFor(side: -1 | 1): number {
  return side * (FACING_CAMERA_BIAS - FACING_QUARTER);
}

/** World-unit height the streaming-text billboard floats above the head bone. */
const BILLBOARD_HEAD_OFFSET = 0.5;

/** Base emissive glow applied to every tinted material before charge/flash heat it up. */
const BASE_EMISSIVE_INTENSITY = 0.3;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function wrap(text: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > charsPerLine) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Finds the rig's `head` joint — every vendored KayKit model names it exactly `head`. */
function findHeadBone(root: THREE.Object3D): THREE.Object3D | null {
  let exact: THREE.Object3D | null = null;
  let partial: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const lower = obj.name.toLowerCase();
    if (lower === 'head') exact = obj;
    else if (!partial && lower.includes('head')) partial = obj;
  });
  return exact ?? partial;
}

/**
 * Finds the rig's striking hand, used to anchor the punch trail.
 *
 * Matched by suffix rather than equality: the vendored rig names its bones
 * `DEF-hand.R` / `DEF-hand.L`, so an exact-name test silently falls through to
 * the first bone merely *containing* "hand" — which is the LEFT one, and the
 * punches are thrown with the right.
 */
function findHandBone(root: THREE.Object3D): THREE.Object3D | null {
  let right: THREE.Object3D | null = null;
  let any: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const lower = obj.name.toLowerCase();
    if (!lower.includes('hand')) return;
    if (!right && (lower.endsWith('hand.r') || lower.endsWith('hand_r') || lower.endsWith('handr'))) {
      right = obj;
    } else if (!any) {
      any = obj;
    }
  });
  return right ?? any;
}

/** How many past fist positions the punch trail keeps. */
const TRAIL_POINTS = 14;
/** Seconds a trail segment takes to fade out once the punch stops moving. */
const TRAIL_FADE_S = 0.22;

const gltfLoader = new GLTFLoader();

export function createFighter(profile: FighterProfile, side: -1 | 1): FighterRig {
  const baseX = side * 2.55;
  const visual = profile.visual;
  const character = characterFor(profile.name);

  const group = new THREE.Group();
  group.position.set(baseX, 0, 0);
  // Height from `modelScale`, build from `bulk` — all four fighters share one
  // mesh now, so width/depth is what keeps a heavyweight from reading exactly
  // like a featherweight. The sprite below divides `modelScale` back out.
  group.scale.set(
    character.modelScale * character.bulk,
    character.modelScale,
    character.modelScale * character.bulk
  );

  // Holds the loaded glTF scene once it arrives; rotated so the model (authored
  // facing +Z) faces across the arena toward the opponent.
  const model = new THREE.Group();
  model.rotation.y = facingFor(side);
  group.add(model);

  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  let currentAction: THREE.AnimationAction | null = null;
  let headBone: THREE.Object3D | null = null;
  let handBone: THREE.Object3D | null = null;
  const tintedMaterials: THREE.MeshStandardMaterial[] = [];

  // --- punch trail --------------------------------------------------------
  //
  // A short ribbon of the striking fist's recent positions. It exists because a
  // punch that lands in two frames is easy to miss entirely at 60fps — the
  // streak is what makes the strike legible as a strike.
  const trailPositions = new Float32Array(TRAIL_POINTS * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trailMaterial = new THREE.LineBasicMaterial({
    color: profile.accent,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const trail = new THREE.Line(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  trail.visible = false;
  group.add(trail);

  let trailStrength = 0;
  let trailPrimed = false;

  let pendingPose: PoseName = 'idle';
  /** Rotates through each pose's clip list so repeats alternate instead of repeating. */
  const variantCursor = new Map<PoseName, number>();

  function clipFor(pose: PoseName): string | null {
    const options = POSE_CLIPS[pose];
    if (!options.length) return null;
    // Only advance the cursor for poses that actually have a variant to reach.
    if (options.length === 1) return options[0];
    const next = (variantCursor.get(pose) ?? 0) % options.length;
    variantCursor.set(pose, next + 1);
    return options[next];
  }

  function applyPose(pose: PoseName): void {
    if (!mixer) return;
    const clipName = clipFor(pose);
    if (!clipName) return;
    const nextAction = actions.get(clipName);
    if (!nextAction) return; // this rig doesn't have the clip — keep whatever is playing
    const clamp = CLAMP_POSES.has(pose);
    nextAction.reset();
    nextAction.setLoop(clamp ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    nextAction.clampWhenFinished = clamp;
    nextAction.timeScale = POSE_TIME_SCALE[pose];
    nextAction.play();
    if (currentAction && currentAction !== nextAction) {
      currentAction.crossFadeTo(nextAction, POSE_BLEND[pose], false);
    } else if (currentAction === nextAction) {
      // Re-triggering the pose that is already playing (jab, jab) — restart it
      // from the top rather than letting the clamped action sit finished.
      nextAction.fadeIn(POSE_BLEND[pose]);
    }
    currentAction = nextAction;
  }

  gltfLoader.load(
    characterAssetUrl(character.model, import.meta.env.BASE_URL),
    (gltf) => {
      const scene = gltf.scene;

      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = materials.map((material) => {
          const clone = (material as THREE.MeshStandardMaterial).clone();
          clone.color.setHex(character.skin);
          if ('emissive' in clone) {
            (clone as THREE.MeshStandardMaterial).emissive.setHex(character.skin);
            (clone as THREE.MeshStandardMaterial).emissiveIntensity = BASE_EMISSIVE_INTENSITY;
          }
          tintedMaterials.push(clone as THREE.MeshStandardMaterial);
          return clone;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      });

      model.add(scene);
      headBone = findHeadBone(scene);
      handBone = findHandBone(scene);

      mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations) {
        actions.set(clip.name, mixer.clipAction(clip));
      }
      applyPose(pendingPose);
    },
    undefined,
    () => {
      // A missing/broken model asset must never break the rig — the billboard
      // (and the rest of the match) keeps working with no body attached.
    }
  );

  // --- the floating streaming-text billboard ------------------------------

  const screenW = visual.screenSize[0];
  const screenH = visual.screenSize[1];
  const maxLines = Math.max(3, Math.round(6 * (screenH / 400)));
  const charsPerLine = Math.max(10, Math.round(30 * (screenW / 640)));

  const canvas = document.createElement('canvas');
  canvas.width = screenW;
  canvas.height = screenH;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(spriteMaterial);
  // World-unit size the billboard should read at, regardless of this fighter's
  // model scale — divide out `character.modelScale` since the sprite is a
  // child of `group`, which already carries that scale.
  const worldW = 2.15 * (screenW / 640);
  const worldH = 1.34 * (screenH / 400);
  // `group` carries a non-uniform scale (bulk on x/z, plain scale on y), so the
  // billboard divides each axis back out or a heavyweight's text reads stretched.
  sprite.scale.set(
    worldW / (character.modelScale * character.bulk),
    worldH / character.modelScale,
    1
  );
  // Fallback position (roughly head height) until the real head bone loads.
  sprite.position.set(0, 3.12 / character.modelScale, 0);
  group.add(sprite);

  let currentText = '';
  let redraw = true;
  let blinkOn = true;
  let blinkTimer = 0;

  function paint(): void {
    ctx.fillStyle = '#040810';
    ctx.fillRect(0, 0, screenW, screenH);

    ctx.fillStyle = hex(visual.color);
    ctx.fillRect(0, 0, screenW, 52);
    ctx.fillStyle = '#040810';
    ctx.font = 'bold 28px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(`▌${profile.name}`, 16, 27);
    ctx.fillText('— □ ×', screenW - 130, 27);

    ctx.font = '24px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = hex(visual.accent);
    const lines = wrap(currentText, charsPerLine).slice(-maxLines);
    lines.forEach((line, i) => ctx.fillText(line, 16, 92 + i * 34));

    if (blinkOn) {
      const last = lines[lines.length - 1] ?? '';
      const cursorX = 16 + ctx.measureText(last).width + 6;
      const cursorY = 92 + Math.max(0, lines.length - 1) * 34;
      ctx.fillRect(cursorX, cursorY - 12, 13, 25);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 52; y < screenH; y += 4) ctx.fillRect(0, y, screenW, 2);

    texture.needsUpdate = true;
  }
  paint();

  // --- state ---------------------------------------------------------------

  let charge = 0;
  let flashAmount = 0;
  const headWorld = new THREE.Vector3();
  const handWorld = new THREE.Vector3();

  return {
    group,

    setPose(pose) {
      pendingPose = pose;
      // Light the trail on the strike itself; every other pose lets it die out.
      if (pose === 'attack') {
        trailStrength = 1;
        trailPrimed = false;
      }
      applyPose(pose);
    },

    setScreenText(text) {
      currentText = text;
      redraw = true;
    },

    setCharge(value) {
      charge = Math.max(0, Math.min(1, value));
    },

    flash(intensity) {
      flashAmount = intensity;
    },

    headPosition() {
      if (headBone) {
        headBone.getWorldPosition(headWorld);
        headWorld.y += BILLBOARD_HEAD_OFFSET;
        return headWorld.clone();
      }
      return sprite.getWorldPosition(new THREE.Vector3());
    },

    update(dt, _elapsed) {
      if (mixer) mixer.update(dt);

      // Punch trail: follow the fist while the strike is hot, then fade.
      if (handBone && trailStrength > 0) {
        handBone.getWorldPosition(handWorld);
        group.worldToLocal(handWorld);
        if (!trailPrimed) {
          // First frame of a punch — collapse the ribbon onto the fist so it
          // doesn't streak in from wherever the hand was last punch.
          for (let i = 0; i < TRAIL_POINTS; i += 1) {
            trailPositions.set([handWorld.x, handWorld.y, handWorld.z], i * 3);
          }
          trailPrimed = true;
        } else {
          trailPositions.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
          trailPositions.set([handWorld.x, handWorld.y, handWorld.z], 0);
        }
        trailGeometry.attributes.position.needsUpdate = true;
        trailStrength = Math.max(0, trailStrength - dt / TRAIL_FADE_S);
        trailMaterial.opacity = trailStrength * 0.9;
        trail.visible = true;
      } else if (trail.visible) {
        trail.visible = false;
        trailPrimed = false;
      }

      if (headBone) {
        headBone.getWorldPosition(headWorld);
        headWorld.y += BILLBOARD_HEAD_OFFSET;
        group.worldToLocal(headWorld);
        sprite.position.copy(headWorld);
      }

      flashAmount *= 0.86;
      for (const material of tintedMaterials) {
        material.emissiveIntensity = BASE_EMISSIVE_INTENSITY + charge * 0.85 + flashAmount;
      }

      blinkTimer += dt;
      if (blinkTimer > 0.45) {
        blinkTimer = 0;
        blinkOn = !blinkOn;
        redraw = true;
      }
      if (redraw) {
        redraw = false;
        paint();
      }
    }
  };
}
