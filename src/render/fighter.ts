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

/** Maps the rig's abstract pose vocabulary onto the vendored KayKit clip names. */
const POSE_CLIPS: Record<PoseName, string> = {
  idle: 'Idle',
  windup: 'Blocking',
  attack: 'Unarmed_Melee_Attack_Punch_A',
  guard: 'Block',
  hurt: 'Hit_A',
  ko: 'Death_A',
  win: 'Cheer'
};

/** K.O. holds its last frame instead of looping — every other pose loops. */
const CLAMP_POSES: ReadonlySet<PoseName> = new Set(['ko']);

/** The vendored rigs are authored facing +Z; this turns them to face the opponent. */
const FACING_OFFSET = Math.PI;

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

const gltfLoader = new GLTFLoader();

export function createFighter(profile: FighterProfile, side: -1 | 1): FighterRig {
  const baseX = side * 2.55;
  const visual = profile.visual;
  const character = characterFor(profile.name);

  const group = new THREE.Group();
  group.position.set(baseX, 0, 0);
  group.scale.setScalar(character.modelScale);

  // Holds the loaded glTF scene once it arrives; rotated so the model (authored
  // facing +Z) faces across the arena toward the opponent.
  const model = new THREE.Group();
  model.rotation.y = (side === 1 ? Math.PI : 0) + FACING_OFFSET;
  group.add(model);

  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  let currentAction: THREE.AnimationAction | null = null;
  let headBone: THREE.Object3D | null = null;
  const tintedMaterials: THREE.MeshStandardMaterial[] = [];

  let pendingPose: PoseName = 'idle';

  function applyPose(pose: PoseName): void {
    if (!mixer) return;
    const clipName = POSE_CLIPS[pose];
    const nextAction = actions.get(clipName);
    if (!nextAction) return; // this rig doesn't have the clip — keep whatever is playing
    const clamp = CLAMP_POSES.has(pose);
    nextAction.reset();
    nextAction.setLoop(clamp ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    nextAction.clampWhenFinished = clamp;
    nextAction.play();
    if (currentAction && currentAction !== nextAction) {
      currentAction.crossFadeTo(nextAction, 0.2, false);
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
  sprite.scale.set(worldW / character.modelScale, worldH / character.modelScale, 1);
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

  return {
    group,

    setPose(pose) {
      pendingPose = pose;
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
