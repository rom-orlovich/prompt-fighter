/**
 * A fighter is a real, realistically-proportioned character model.
 *
 * Three vendored assets combine into one fighter, all sharing a single skeleton
 * (Quaternius, CC0): a **body** mesh, a **hairstyle** rigged to that same
 * skeleton, and a shared **clip library** — the bodies ship with no animations
 * of their own. Clips and hair bind to the body's bones by NAME, which is why
 * the vendored library has to be the Unreal-named export.
 *
 * All three load asynchronously through `GLTFLoader` and are driven by an
 * `AnimationMixer` (see `POSE_CLIPS`), but
 * `createFighter()` itself stays synchronous: it returns a fully-formed
 * `FighterRig` immediately, and the loaded geometry/animations simply appear
 * inside `group` once the fetch resolves. Callers (`main.ts`, `select.ts`)
 * never know or care whether the model has finished loading yet.
 *
 * A fighter used to carry a camera-facing CRT billboard hovering above its
 * head, streaming the model's reply as canvas text (G13 removed it). The HUD
 * subtitle bar already renders the exact same streaming text, larger and at
 * the same moment, and the billboard's only other job — printing a name — is
 * already handled by the label under each character-select card. A second,
 * moving copy of the same text in-world bought nothing but a sprite that could
 * (and, once footwork closed the gap between fighters, did) land on top of a
 * fighter's own head or the opponent's sprite.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FighterProfile } from '../fighters';
import { characterFor, characterAssetUrl, ANIMATION_ASSET } from '../roster/characters';

export type PoseName =
  | 'idle'
  | 'windup'
  | 'attack'
  | 'guard'
  | 'hurt'
  /**
   * A heavier hit reaction than `hurt` — crits, counters and supers land here
   * instead (G17), so a fight-ending blow visibly reads as harder than a jab
   * landing rather than replaying the exact same flinch at every damage tier.
   */
  | 'hurtHeavy'
  /** A reactive sidestep/duck — played on whichever fighter's opponent just
   * broke a combo (see `case 'comboBreak'` in main.ts). */
  | 'dodge'
  | 'ko'
  | 'win';

export interface FighterRig {
  group: THREE.Group;
  setPose(pose: PoseName): void;
  /** The pose currently held — lets callers avoid stomping `ko`/`win`. */
  currentPose(): PoseName;
  setCharge(value: number): void;
  flash(intensity: number): void;
  /**
   * `dt` is hit-stopped simulation time and drives the animation mixer;
   * `real` (defaulting to `dt`) drives the positional lunge/knockback so a
   * fighter still gets shoved during the freeze frame of an impact.
   */
  update(dt: number, elapsed: number, real?: number): void;
  headPosition(): THREE.Vector3;
  /** World position of the striking (right) fist — where a punch actually is. */
  handPosition(): THREE.Vector3;
  /** World position of the chest — what a punch is aimed at. */
  chestPosition(): THREE.Vector3;
  /** World position of the hips/pelvis — drops toward the floor on a K.O. */
  rootPosition(): THREE.Vector3;
  /** Current world position of the whole fighter (neutral X plus any offset). */
  worldPosition(): THREE.Vector3;
  /**
   * World-space vertical extent of the loaded body + hair meshes — `null` until
   * both have settled (loaded or failed to load). Self-correcting camera framing
   * (see `select.ts`) reads this instead of a hard-coded height, so a future
   * rescale re-frames the preview instead of silently cropping a head again.
   */
  measuredBounds(): { top: number; bottom: number } | null;
  /** Neutral X this fighter recovers to. */
  neutralX(): number;
  /** Step in toward the opponent so a strike actually reaches: 0-1 scale. */
  lunge(amount: number): void;
  /** Get shoved away from the opponent, then spring back: world units. */
  knockback(amount: number): void;
  /**
   * Current knockback displacement in world units, signed away from the
   * opponent. Reported separately from `worldPosition` because a fighter's X
   * is the sum of *two* independent motions — being shoved, and stepping in to
   * throw its own next punch — and only the first is knockback.
   */
  knockbackOffset(): number;
  /** Snap back to the neutral corner, cancelling any lunge or knockback. */
  resetStance(): void;
  /**
   * Every vendored clip NAME (not abstract `PoseName`) actually played on this
   * rig so far — `attack`/`hurt`/etc. each rotate through several clips, so
   * this is the real measure of how much of the vocabulary a match exercises
   * (G17; see the "distinct clips" assertion in e2e/fight-feel.test.ts).
   */
  playedClips(): ReadonlySet<string>;
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
  // A combat-ready stance that actually loops, so a fighter waiting out a long
  // turn still breathes instead of standing frozen.
  idle: ['Sword_Idle'],
  // `Melee_Hook` (G17, vendored from Universal Animation Library 2) is a real
  // third strike, so `attack` rotates through three distinct punches instead
  // of two — a fighter that only ever threw the same two blows was the single
  // biggest gap the move-vocabulary critic loop flagged.
  attack: ['Punch_Jab', 'Punch_Cross', 'Melee_Hook'],
  // `windup` fires at the start of every turn, so it is on screen more than any
  // other pose. It freezes `Punch_Jab` partway in (see POSE_FREEZE) to hold a
  // real fists-up boxing guard — an earlier pass used the rig's crouch here and
  // it read as the fighter squatting rather than loading up a punch.
  windup: ['Punch_Jab'],
  // A real guard stance (G17, vendored from UAL2) — arms crossed up covering
  // the head/chest, looped rather than frozen. This used to hold `Punch_Jab`
  // a little deeper into its wind than `windup` (see the old POSE_FREEZE.guard
  // entry, since removed): serviceable, but it was visibly the SAME pose as
  // the windup, just a few frames later, so a blocked exchange and a loading
  // punch read as identical stances. `Idle_Shield_Loop` is a stance actually
  // authored to be held, not a punch frozen mid-swing.
  guard: ['Idle_Shield_Loop'],
  hurt: ['Hit_Head', 'Hit_Chest'],
  // See the `hurtHeavy` PoseName doc comment. `Hit_Knockback` (G17, UAL2) is
  // the only clip in either vendored library that reads as a fighter actually
  // getting rocked rather than just flinching — hands thrown up, knocked off
  // balance, catching itself — so it is reserved for blows already staged as
  // dramatic (a crit, a counter, a super), never a plain jab.
  hurtHeavy: ['Hit_Knockback'],
  // `Slide_Start` (G17, UAL2) frozen mid-slide (see POSE_FREEZE.dodge) reads as
  // a low duck-and-lean out of the way — played on a fighter whose opponent's
  // combo just broke, which used to have no visible reaction at all.
  dodge: ['Slide_Start'],
  ko: ['Death01'],
  win: ['Dance_Loop']
};

/** Poses that hold their final frame instead of looping. */
const CLAMP_POSES: ReadonlySet<PoseName> = new Set<PoseName>(['ko', 'attack', 'hurt', 'hurtHeavy', 'dodge']);

/**
 * Poses held at a fraction of their clip instead of played through.
 *
 * The Unreal-named animation library (the only export whose bone names match
 * these bodies) has no dedicated fighting-stance clip. `Punch_Jab` passes
 * through a textbook guard — fists up at face level — about a fifth of the way
 * in, so `windup` plays to there and pauses. Picked by rendering the clip at
 * several fractions and looking at them, not by guessing.
 *
 * `dodge` uses the same technique on `Slide_Start` (G17), but landed somewhere
 * different than the isolated-clip look suggested: a mid-clip freeze (~0.4-0.6,
 * a low lean with one arm braced toward the ground) reads fine on an isolated
 * probe rig against a grid floor, but in the ACTUAL match — this game's camera
 * angle, the fighter's own facing rotation, the ring floor — the same frame
 * reads as the fighter having fallen down, not ducked (confirmed on a real
 * GPU with the game's own camera: two independent live-match screenshot
 * passes at 0.58 both showed what unambiguously looks like a knockdown, not
 * an evade — rejected after looking at it, not shipped). 0.15 — much earlier
 * in the clip, a compact low crouch with the knee still bent under the hip
 * rather than the leg extended along the ground — reads as ducking when
 * checked the same way. Always judge a frozen frame in the real render
 * context it will actually appear in, not just an isolated preview.
 */
const POSE_FREEZE: Partial<Record<PoseName, number>> = {
  windup: 0.18,
  dodge: 0.15
};

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
  // Snappier than `hurt` (0.05s) would already cover it, but explicit: a
  // heavy blow should slam into its reaction with even less blend, not more.
  hurtHeavy: 0.04,
  dodge: 0.1,
  ko: 0.12,
  win: 0.3
};

/**
 * Seconds `measuredBounds()` (see below) waits after the idle pose is applied
 * before trusting a measurement — comfortably past `POSE_BLEND.idle` (220ms)
 * so a newly-activated skinned mesh has fully settled out of its pre-animation
 * rest state before its silhouette is measured for the select-screen camera.
 */
const POSE_SETTLE_MARGIN_S = 0.5;

/** Per-pose playback rate. */
const POSE_TIME_SCALE: Record<PoseName, number> = {
  idle: 0.8,
  windup: 1.4,
  attack: 1.15,
  // Was 0.7 back when `guard` was a punch frozen mid-wind (slowed to make the
  // freeze look deliberate rather than paused mid-swing). `Idle_Shield_Loop`
  // is authored to be held, so it plays at a natural, watchful pace instead.
  guard: 0.9,
  hurt: 1.1,
  // Faster than `hurt`: a heavy blow should snap into its reaction, not ease
  // into it — `Hit_Knockback`'s own ~0.83s duration is already the longest of
  // any hit reaction in the vendored set, so this keeps it from dragging.
  hurtHeavy: 1.2,
  dodge: 1.3,
  ko: 1,
  win: 1.15
};

/**
 * The victory flourish, layered on top of `Dance_Loop` rather than replacing
 * it — measured, `win` on its own moves the winner's hand ~0.5 world units
 * total across a 3s window, which reads as "standing next to a body", not a
 * celebration. This is a fist-pump jump: both arms swing up in time with a
 * hop, applied as a world-space rotation so it reads correctly regardless of
 * the vendored rig's own local bone-axis convention.
 */
const VICTORY_CYCLE_HZ = 2.1;
/**
 * Peak arm swing, in radians, added on top of whatever `Dance_Loop` is doing.
 * Tuned by rendering and looking at it: past ~2.2 the arms swing far enough
 * behind the shoulder to vanish behind the torso/head from the camera's
 * front-on angle, which reads as broken rather than triumphant.
 */
const VICTORY_ARM_SWING = 2.05;
/** Peak hop height, in world units. */
const VICTORY_HOP_HEIGHT = 0.7;
/** Seconds the winner takes to turn from its 3/4 fighting stance to face the camera. */
const VICTORY_FACE_TURN_S = 0.4;

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

/**
 * World-unit height `headPosition()` reports above the actual head bone, so a
 * floating damage number reads as coming from over the fighter's head instead
 * of from inside its skull. Formerly also where the streaming-text billboard
 * floated (G13 removed the billboard; this offset survives for the damage
 * numbers alone).
 */
const HEAD_MARKER_OFFSET = 0.5;

/** Base emissive glow applied to every tinted material before charge/flash heat it up. */
const BASE_EMISSIVE_INTENSITY = 0.3;

/** Hair reads as hair, not as brand paint — it stays dark on every fighter. */
const HAIR_COLOR = 0x23232b;

/** Finds the rig's head joint — the vendored bodies name it exactly `Head`. */
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

/** Finds a bone by exact (case-insensitive) name, e.g. `pelvis` or `spine_02`. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found || !(obj as THREE.Bone).isBone) return;
    if (obj.name.toLowerCase() === name) found = obj;
  });
  return found;
}

/**
 * Finds the rig's striking hand, used to anchor the punch trail.
 *
 * Matched by suffix rather than equality, and right-hand-first: the bones are
 * named `hand_r` / `hand_l`, and a test that merely *contains* "hand" picks the
 * left one (it traverses first) while the punches are thrown with the right.
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

/**
 * Neutral half-spacing: how far each fighter stands from the centre of the ring.
 *
 * This used to be 2.55 — a 5.1-unit gap, wider than either fighter is tall. Every
 * punch landed in empty air while the other fighter flinched in the opposite
 * corner. At 1.05 the pair stand a 2.1-unit gap apart; the vendored rig's fist
 * reaches ~1.0 units past its own centre, so once the attacker steps in the
 * glove lands on the opponent's chest. Both numbers were measured against the
 * loaded rig (scripts/probe-reach.mjs), not guessed.
 */
export const NEUTRAL_HALF_SPACING = 1.05;

/** How far a fighter steps in on a strike, in world units. */
const LUNGE_DISTANCE = 0.85;
/** Seconds the step-in takes to reach full extension. */
const LUNGE_IN_S = 0.11;
/** Seconds the fighter holds at full extension before recovering. */
const LUNGE_HOLD_S = 0.1;
/** Seconds to walk back out to neutral. */
const LUNGE_OUT_S = 0.34;

/**
 * Knockback is a critically-damped spring back to neutral, kicked by an
 * impulse. A fixed-length envelope was tried first and reads wrong the moment
 * two blows overlap: restarting the curve snaps the fighter back toward centre
 * before shoving it out again. A spring just takes the second impulse on top of
 * whatever is left of the first, which is what a body actually does.
 *
 * `KNOCK_OMEGA` is the spring's natural frequency in rad/s: peak displacement
 * lands ~1/omega seconds after the hit and the fighter is home well inside a
 * second.
 */
const KNOCK_OMEGA = 9;
/** World units per second of velocity per unit of requested knockback. */
const KNOCK_IMPULSE = 16;

/** Smoothstep, used to ease the recovery legs of lunge/knockback. */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * The step-in envelope: snap in, hold at the point of contact, walk back out.
 * Returns 0-1, where 1 is fully committed toward the opponent.
 */
function lungeEnvelope(t: number): number {
  if (t <= 0) return 0;
  if (t < LUNGE_IN_S) return smoothstep(t / LUNGE_IN_S);
  if (t < LUNGE_IN_S + LUNGE_HOLD_S) return 1;
  const out = (t - LUNGE_IN_S - LUNGE_HOLD_S) / LUNGE_OUT_S;
  return out >= 1 ? 0 : 1 - smoothstep(out);
}

const gltfLoader = new GLTFLoader();

export function createFighter(profile: FighterProfile, side: -1 | 1): FighterRig {
  const baseX = side * NEUTRAL_HALF_SPACING;
  const character = characterFor(profile.name);

  const group = new THREE.Group();
  group.position.set(baseX, 0, 0);
  // Height from `modelScale`, build from `bulk` — the free asset tier ships two
  // bodies for four fighters, so width/depth is part of what keeps a heavyweight
  // from reading exactly like a featherweight.
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
  /** Both fists, so `handPosition` can report whichever one is actually thrown. */
  let handBones: THREE.Object3D[] = [];
  let chestBone: THREE.Object3D | null = null;
  let hipBone: THREE.Object3D | null = null;
  // Gate `measuredBounds()` on both assets having settled (loaded or failed) —
  // measuring right after the body loads but before the hair arrives would
  // frame the camera a beat too tight, missing the hair's margin — AND on the
  // idle pose having actually settled into place. The shared clip library
  // (`Anims.glb`, ~2.2MB) is 10-40x larger than any single hairstyle, so on a
  // real network the hair reliably finishes loading before the animation
  // library does: without a pose gate, `measuredBounds()` would take its
  // one-and-only measurement while the skeleton still sits in its unposed
  // rest state, not the crouched `Sword_Idle` stance the preview actually
  // renders in every frame after that (G16).
  //
  // A newly-`play()`ed `AnimationAction`'s bound properties don't snap to the
  // animated pose in a single `update()` tick — verified empirically against
  // the real preview: measuring `measuredBounds()` immediately after
  // `poseApplied` goes true intermittently reads a hair mesh still mid-blend
  // from its pre-animation rest state (its top-of-head vertices land near
  // body height instead of above it), and the gap needed to clear that
  // consistently tracks WALL-CLOCK TIME elapsed since the pose was applied,
  // not frame or `update()` call count — consistent with `POSE_BLEND.idle`
  // (220ms) still being mid-crossfade. `POSE_SETTLE_MARGIN_S` below waits
  // comfortably past that before trusting a measurement.
  let bodyLoaded = false;
  let hairSettled = false;
  let poseApplied = false;
  /** Elapsed-clock time (see `update`'s `elapsed` param) at which `poseApplied`
   * first went true — `null` until then. */
  let poseAppliedAtElapsed: number | null = null;
  /** Most recent `elapsed` seen by `update` — `measuredBounds()` has no clock
   * of its own, so it reads this to know how long the pose has had to settle. */
  let latestElapsed = 0;
  /** Both shoulders — the victory flourish swings from here, not the wrist, so a
   * modest rotation still carries the hand through a wide arc. */
  let upperArmBones: THREE.Object3D[] = [];
  const tintedMaterials: THREE.MeshStandardMaterial[] = [];

  // --- footwork -----------------------------------------------------------
  //
  // The fighter's X is `baseX` plus two independent, self-recovering offsets:
  // a step-in on its own strike and a shove on a strike it eats. Both are
  // signed toward/away from the opponent (which is always across the origin,
  // so "toward the opponent" is simply `-side`).
  let lungeTime = Infinity;
  let lungeScale = 0;
  let knockOffset = 0;
  let knockVelocity = 0;

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

  // --- victory flourish -----------------------------------------------------
  //
  // Seconds since this rig last entered `win`; drives the hop/arm-pump cycle.
  // Reset whenever `win` is (re-)entered so a rematch doesn't inherit the
  // previous match's phase.
  let victoryTime = 0;
  // Scratch objects for the world-space bone rotation, reused every frame so
  // the flourish allocates nothing per tick (see `update`).
  const victoryWorldAxis = new THREE.Vector3(1, 0, 0);
  const victoryParentQuat = new THREE.Quaternion();
  const victoryLocalAxis = new THREE.Vector3();
  const victoryDelta = new THREE.Quaternion();

  let pendingPose: PoseName = 'idle';
  /** Action pinned to a held frame (see POSE_FREEZE), and the frame it holds. */
  let frozenAction: THREE.AnimationAction | null = null;
  let frozenTime = 0;
  /** Rotates through each pose's clip list so repeats alternate instead of repeating. */
  const variantCursor = new Map<PoseName, number>();
  /** See `playedClips()` on `FighterRig`. */
  const playedClipNames = new Set<string>();

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
    playedClipNames.add(clipName);
    const freeze = POSE_FREEZE[pose];
    const clamp = CLAMP_POSES.has(pose);
    nextAction.reset();
    nextAction.setLoop(clamp || freeze !== undefined ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    nextAction.clampWhenFinished = clamp || freeze !== undefined;
    nextAction.timeScale = POSE_TIME_SCALE[pose];
    nextAction.paused = false;
    nextAction.play();
    if (currentAction && currentAction !== nextAction) {
      currentAction.crossFadeTo(nextAction, POSE_BLEND[pose], false);
    } else {
      // Re-triggering the clip that is already playing — `windup` and `attack`
      // both use `Punch_Jab`, so this is the common path into a punch, not an
      // edge case. Snap it back to full weight instead of fading in from zero:
      // `reset()` leaves whatever weight the last fade left behind, and fading
      // 0 -> 1 on the *only* action playing drops the skeleton to its bind pose
      // for the length of the blend. That is the arms-out T-pose that flashed
      // on screen at the start of every other strike.
      nextAction.setEffectiveWeight(1);
    }
    currentAction = nextAction;
    poseApplied = true;
    // A frozen pose seeks to its held frame and stops there. `update` still runs
    // the mixer so the crossfade into this pose completes.
    if (freeze !== undefined) {
      frozenAction = nextAction;
      frozenTime = nextAction.getClip().duration * freeze;
    } else {
      frozenAction = null;
    }
  }

  /** Tints one loaded mesh into this fighter's brand hue and registers its materials. */
  function tint(mesh: THREE.Mesh, color: number, emissive: boolean): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((material) => {
      const clone = (material as THREE.MeshStandardMaterial).clone();
      clone.color.setHex(color);
      // The vendor step (G15) never embeds a base-colour map for the body — only
      // its normal and roughness maps survive, so `map` is already null and the
      // brand tint above stays a flat, readable colour. Do NOT null `normalMap`/
      // `roughnessMap`/`metalnessMap` here: those are what give the tinted body
      // real surface form (muscle definition, non-uniform specular) instead of
      // reading as painted plastic.
      if ('emissive' in clone && emissive) {
        (clone as THREE.MeshStandardMaterial).emissive.setHex(color);
        (clone as THREE.MeshStandardMaterial).emissiveIntensity = BASE_EMISSIVE_INTENSITY;
        tintedMaterials.push(clone as THREE.MeshStandardMaterial);
      }
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  }

  const base = import.meta.env.BASE_URL;

  // Body first: it owns the skeleton that both the clips and the hair bind to.
  gltfLoader.load(
    characterAssetUrl(character.body, base),
    (gltf) => {
      const scene = gltf.scene;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) tint(mesh, character.skin, true);
      });

      model.add(scene);
      headBone = findHeadBone(scene);
      handBone = findHandBone(scene);
      // Unreal-named skeleton: `spine_03` sits at sternum height and `pelvis` is
      // the hip root that `Death01` drives to the floor.
      handBones = [findBone(scene, 'hand_r'), findBone(scene, 'hand_l')].filter(
        (bone): bone is THREE.Object3D => bone !== null
      );
      chestBone = findBone(scene, 'spine_03') ?? findBone(scene, 'spine_02') ?? headBone;
      hipBone = findBone(scene, 'pelvis') ?? findBone(scene, 'root');
      upperArmBones = [findBone(scene, 'upperarm_l'), findBone(scene, 'upperarm_r')].filter(
        (bone): bone is THREE.Object3D => bone !== null
      );
      bodyLoaded = true;

      mixer = new THREE.AnimationMixer(scene);

      // Clips live in their own file — the bodies ship with zero animations —
      // and bind by bone NAME, which is why the vendored library has to be the
      // Unreal-named export that shares this skeleton.
      gltfLoader.load(
        characterAssetUrl(ANIMATION_ASSET, base),
        (animGltf) => {
          if (!mixer) return;
          for (const clip of animGltf.animations) {
            actions.set(clip.name, mixer.clipAction(clip));
          }
          applyPose(pendingPose);
        },
        undefined,
        () => {
          // No clips: the fighter still renders, just without animation.
        }
      );

      // Hair is a separate skinned mesh authored against the same skeleton.
      // Rebind it onto THIS body's bones by name rather than parenting the raw
      // geometry to the head bone — that leaves it floating in bind space.
      const bodyBones = new Map<string, THREE.Bone>();
      scene.traverse((obj) => {
        const bone = obj as THREE.Bone;
        if (bone.isBone) bodyBones.set(bone.name, bone);
      });

      gltfLoader.load(
        characterAssetUrl(character.hair, base),
        (hairGltf) => {
          let hairMesh: THREE.SkinnedMesh | null = null;
          hairGltf.scene.traverse((obj) => {
            const skinned = obj as THREE.SkinnedMesh;
            if (skinned.isSkinnedMesh && !hairMesh) hairMesh = skinned;
          });
          if (hairMesh) {
            const skinned = hairMesh as THREE.SkinnedMesh;
            const bones = skinned.skeleton.bones.map((bone) => bodyBones.get(bone.name) ?? bone);
            tint(skinned, HAIR_COLOR, false);
            skinned.bind(new THREE.Skeleton(bones, skinned.skeleton.boneInverses), skinned.bindMatrix);
            scene.add(skinned);
          }
          hairSettled = true;
        },
        undefined,
        () => {
          // No hair: the fighter is simply bald, which is not worth failing over.
          hairSettled = true;
        }
      );

      applyPose(pendingPose);
    },
    undefined,
    () => {
      // A missing/broken model asset must never break the rig — the rest of
      // the match keeps working with no body attached.
    }
  );

  // --- state ---------------------------------------------------------------

  let charge = 0;
  let flashAmount = 0;
  const headWorld = new THREE.Vector3();
  const handWorld = new THREE.Vector3();
  const handLead = new THREE.Vector3();

  /** World position of `bone`, or `fallback` (a local-space y offset) if unloaded. */
  function boneWorld(bone: THREE.Object3D | null, fallbackY: number): THREE.Vector3 {
    if (bone) return bone.getWorldPosition(new THREE.Vector3());
    return group.localToWorld(new THREE.Vector3(0, fallbackY / character.modelScale, 0));
  }

  return {
    group,

    setPose(pose) {
      // (Re-)entering `win` restarts the flourish's hop/pump cycle from the
      // bottom rather than picking up wherever the last celebration left off.
      if (pose === 'win' && pendingPose !== 'win') victoryTime = 0;
      pendingPose = pose;
      // Light the trail on the strike itself; every other pose lets it die out.
      if (pose === 'attack') {
        trailStrength = 1;
        trailPrimed = false;
      }
      applyPose(pose);
    },

    currentPose() {
      return pendingPose;
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
        headWorld.y += HEAD_MARKER_OFFSET;
        return headWorld.clone();
      }
      // Before the body has loaded there is no head bone yet — fall back to
      // roughly head height, the same convention `boneWorld` uses for the
      // hand/chest/hip bones below.
      return boneWorld(null, 3.12);
    },

    handPosition() {
      // Whichever fist is furthest toward the opponent. `attack` alternates
      // `Punch_Jab` and `Punch_Cross` and they do NOT lead with the same hand,
      // so always reporting `hand_r` said "the punch fell half a metre short"
      // on every other strike — when the other glove was on the chest.
      if (handBones.length) {
        let lead = handBones[0]!;
        let best = Infinity;
        for (const bone of handBones) {
          const x = side * bone.getWorldPosition(handLead).x;
          if (x < best) {
            best = x;
            lead = bone;
          }
        }
        return lead.getWorldPosition(new THREE.Vector3());
      }
      return boneWorld(handBone, 1.9);
    },

    chestPosition() {
      return boneWorld(chestBone, 2.35);
    },

    rootPosition() {
      return boneWorld(hipBone, 1.55);
    },

    worldPosition() {
      return group.getWorldPosition(new THREE.Vector3());
    },

    playedClips() {
      return playedClipNames;
    },

    measuredBounds() {
      if (!bodyLoaded || !hairSettled || !poseApplied || poseAppliedAtElapsed === null) return null;
      // See the `POSE_SETTLE_MARGIN_S` comment above `bodyLoaded`: a
      // newly-activated pose doesn't finish blending into its animated state
      // in a single tick, so wait past that before trusting a measurement.
      if (latestElapsed - poseAppliedAtElapsed < POSE_SETTLE_MARGIN_S) return null;
      // `model` holds only the loaded body scene (and the hair rebound onto it,
      // see above) — never the punch trail, which would otherwise pull the box
      // out toward the fist. `updateWorldMatrix(true, true)` forces the whole
      // ancestor chain AND every descendant (bones included) current first,
      // so this is correct regardless of whether a render happened yet.
      model.updateWorldMatrix(true, true);
      // `precise: true` makes three.js walk every vertex through its bone
      // transform instead of taking the mesh's cached `SkinnedMesh.boundingBox`
      // — which three.js computes lazily on first touch and then NEVER
      // recomputes on its own (see the class's own docs: "the bounding box
      // should be recomputed per frame in order to reflect the current
      // animation state"). Without `precise`, whichever pose happened to be
      // current the first time ANY code touched this mesh's bounding box would
      // stick forever, silently reintroducing the exact stale-pose bug the
      // gates above exist to prevent.
      const box = new THREE.Box3().setFromObject(model, true);
      return { top: box.max.y, bottom: box.min.y };
    },

    neutralX() {
      return baseX;
    },

    lunge(amount) {
      lungeScale = Math.max(0, amount);
      lungeTime = 0;
    },

    knockback(amount) {
      // Impulse, not a reset: a crit landing on a fighter still reeling from a
      // jab shoves it further out rather than yanking it back to centre first.
      knockVelocity += side * amount * KNOCK_IMPULSE;
    },

    knockbackOffset() {
      return knockOffset;
    },

    resetStance() {
      lungeTime = Infinity;
      lungeScale = 0;
      knockOffset = 0;
      knockVelocity = 0;
      group.position.x = baseX;
      // A fresh round must not inherit the last round's victory hop/turn —
      // snap both back immediately rather than letting `update` ease them out.
      group.position.y = 0;
      model.rotation.y = facingFor(side);
      victoryTime = 0;
    },

    update(dt, elapsed, real) {
      // See `measuredBounds()`: tracks how long the idle pose has had to
      // settle since `poseApplied` first went true.
      latestElapsed = elapsed;
      if (poseApplied && poseAppliedAtElapsed === null) poseAppliedAtElapsed = elapsed;
      // Footwork runs on REAL time so a fighter still gets blown back during the
      // hit-stop freeze — that shove IS the impact, and freezing it out is what
      // made a 20-damage crit look identical to a whiff.
      const realDt = real ?? dt;
      if (lungeTime < Infinity) {
        lungeTime += realDt;
        if (lungeTime > LUNGE_IN_S + LUNGE_HOLD_S + LUNGE_OUT_S) lungeTime = Infinity;
      }
      if (knockOffset !== 0 || knockVelocity !== 0) {
        // Closed-form step of the critically-damped spring, not Euler. Euler
        // with the frame deltas this app actually sees (up to the 50ms clamp,
        // and the `?fast=1` simulation loop competes with a busy main thread)
        // damps `2*omega*v*dt` clean through zero, and the knockback died in two
        // frames. The analytic solution is correct at any dt.
        const decay = Math.exp(-KNOCK_OMEGA * realDt);
        const slope = knockVelocity + KNOCK_OMEGA * knockOffset;
        const next = (knockOffset + slope * realDt) * decay;
        knockVelocity = (slope - KNOCK_OMEGA * (knockOffset + slope * realDt)) * decay;
        knockOffset = next;
        if (Math.abs(knockOffset) < 1e-4 && Math.abs(knockVelocity) < 1e-3) {
          knockOffset = 0;
          knockVelocity = 0;
        }
      }
      const lungeOffset =
        lungeTime === Infinity ? 0 : -side * LUNGE_DISTANCE * lungeScale * lungeEnvelope(lungeTime);
      group.position.x = baseX + lungeOffset + knockOffset;

      if (mixer) mixer.update(dt);
      // Pin a frozen pose to its held frame every tick: the mixer keeps running
      // so the crossfade into it finishes, but the clip itself never advances.
      if (frozenAction) {
        frozenAction.time = frozenTime;
        frozenAction.paused = true;
      }

      // Victory flourish: `Dance_Loop` alone barely moves the winner (measured:
      // ~0.5 world units of hand travel across a 3s window), so this layers a
      // hop + double-arm-pump on top of it, plus a turn to face the camera. Runs
      // on real time so it keeps going even if a stray hit-stop somehow overlaps
      // the win pose. Fully self-resetting: any pose other than `win` decays the
      // hop/turn back to the fighting stance instead of requiring a separate
      // cleanup path.
      {
        const inVictory = pendingPose === 'win';
        if (inVictory) victoryTime += realDt;
        const cyclePhase = victoryTime * VICTORY_CYCLE_HZ * Math.PI * 2;
        const hop = inVictory ? Math.abs(Math.sin(cyclePhase)) * VICTORY_HOP_HEIGHT : 0;
        group.position.y = hop;

        const facingTarget = inVictory ? 0 : facingFor(side);
        const turnRate = 1 - Math.pow(0.001, realDt / VICTORY_FACE_TURN_S);
        model.rotation.y += (facingTarget - model.rotation.y) * turnRate;

        if (inVictory && upperArmBones.length) {
          // Both arms raise together: rotating around a fixed WORLD axis (rather
          // than each bone's own local axis) means the arms swing up correctly
          // regardless of which way the vendored skeleton's bones are authored,
          // and left/right stay symmetric despite being mirrored in local space.
          const swing = (0.5 - 0.5 * Math.cos(cyclePhase)) * VICTORY_ARM_SWING;
          for (const bone of upperArmBones) {
            if (!bone.parent) continue;
            bone.parent.getWorldQuaternion(victoryParentQuat).invert();
            victoryLocalAxis.copy(victoryWorldAxis).applyQuaternion(victoryParentQuat).normalize();
            victoryDelta.setFromAxisAngle(victoryLocalAxis, swing);
            bone.quaternion.premultiply(victoryDelta);
          }
        }
      }

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

      // Time-based, like the camera shake — a per-frame multiplier made the
      // hit flash last four times longer on a slow machine than a fast one.
      flashAmount *= Math.pow(0.5, realDt / 0.07);
      for (const material of tintedMaterials) {
        material.emissiveIntensity = BASE_EMISSIVE_INTENSITY + charge * 0.85 + flashAmount;
      }
    }
  };
}
