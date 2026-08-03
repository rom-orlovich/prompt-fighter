/**
 * A fighter is a floating terminal window on a body.
 *
 * The head is a canvas texture rendering the model's actual streaming output, so
 * the thing you read and the thing that throws the punch are literally the same
 * object. Poses are seven scalars lerped every frame rather than a skeleton —
 * enough expression for arcade readability, zero asset pipeline.
 *
 * The head hangs off the root rather than the torso: the body twists into a 3/4
 * fighting stance, while the screen stays square to the fixed camera so the text
 * is always readable. That split is the whole trick behind the look.
 */

import * as THREE from 'three';
import type { FighterProfile } from '../fighters';

export type PoseName = 'idle' | 'windup' | 'attack' | 'guard' | 'hurt' | 'ko' | 'win';

interface Pose {
  forward: number;
  crouch: number;
  lean: number;
  punch: number;
  guardUp: number;
  recoil: number;
  fallen: number;
}

const POSES: Record<PoseName, Pose> = {
  idle:   { forward: 0,    crouch: 0,    lean: 0,     punch: 0, guardUp: 0.25, recoil: 0, fallen: 0 },
  windup: { forward: -0.3, crouch: 0.16, lean: -0.24, punch: 0, guardUp: 0.55, recoil: 0, fallen: 0 },
  attack: { forward: 0.8,  crouch: 0.04, lean: 0.36,  punch: 1, guardUp: 0,    recoil: 0, fallen: 0 },
  guard:  { forward: -0.2, crouch: 0.26, lean: -0.12, punch: 0, guardUp: 1,    recoil: 0, fallen: 0 },
  hurt:   { forward: -0.5, crouch: 0.12, lean: -0.42, punch: 0, guardUp: 0,    recoil: 1, fallen: 0 },
  ko:     { forward: -1.1, crouch: 0,    lean: -0.5,  punch: 0, guardUp: 0,    recoil: 1, fallen: 1 },
  win:    { forward: 0,    crouch: -0.1, lean: 0.06,  punch: 0, guardUp: 0.95, recoil: 0, fallen: 0 }
};

const SCREEN_W = 640;
const SCREEN_H = 400;
const MAX_LINES = 6;
const CHARS_PER_LINE = 30;

/** Angle that squares a fighter's screen to the fixed camera. */
const CAMERA_YAW = 0.3;

export interface FighterRig {
  group: THREE.Group;
  setPose(pose: PoseName): void;
  setScreenText(text: string): void;
  setCharge(value: number): void;
  flash(intensity: number): void;
  update(dt: number, elapsed: number): void;
  headPosition(): THREE.Vector3;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > CHARS_PER_LINE) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** Stretch a unit-length box between two local-space points. */
function connect(limb: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const delta = to.clone().sub(from);
  const length = delta.length();
  limb.position.copy(from).addScaledVector(delta, 0.5);
  limb.quaternion.setFromUnitVectors(FORWARD, delta.normalize());
  limb.scale.z = Math.max(length, 0.001);
}

export function createFighter(profile: FighterProfile, side: -1 | 1): FighterRig {
  // `inward` points from this fighter toward the opponent.
  const inward = -side;
  const baseX = side * 2.55;

  const group = new THREE.Group();
  group.position.set(baseX, 0, 0);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: profile.color,
    emissive: profile.color,
    emissiveIntensity: 0.22,
    roughness: 0.4,
    metalness: 0.6
  });
  const limbMaterial = new THREE.MeshStandardMaterial({
    color: 0x121a2b,
    emissive: profile.accent,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.75
  });

  // Body twists into a 3/4 stance so the silhouette reads as a fighter, not a box.
  const body = new THREE.Group();
  body.rotation.y = inward * 0.7;
  group.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.3, 1.05), bodyMaterial);
  torso.position.y = 1.5;
  torso.castShadow = true;
  body.add(torso);

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 1.32), limbMaterial);
  shoulders.position.y = 2.05;
  shoulders.castShadow = true;
  body.add(shoulders);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 0.98), limbMaterial);
  hips.position.y = 0.82;
  hips.castShadow = true;
  body.add(hips);

  const fistMaterial = new THREE.MeshStandardMaterial({
    color: profile.accent,
    emissive: profile.accent,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.5
  });
  const fistLead = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), fistMaterial);
  const fistRear = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), fistMaterial);
  fistLead.castShadow = true;
  fistRear.castShadow = true;
  body.add(fistLead, fistRear);

  const armLead = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 1), limbMaterial);
  const armRear = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 1), limbMaterial);
  body.add(armLead, armRear);

  const footLead = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.44), limbMaterial);
  const footRear = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.44), limbMaterial);
  footLead.castShadow = true;
  footRear.castShadow = true;
  body.add(footLead, footRear);

  const legLead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 1), limbMaterial);
  const legRear = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 1), limbMaterial);
  body.add(legLead, legRear);

  const shoulderLead = new THREE.Vector3(0, 2.02, 0.42);
  const shoulderRear = new THREE.Vector3(0, 1.98, -0.46);
  const hipLead = new THREE.Vector3(0, 0.78, 0.3);
  const hipRear = new THREE.Vector3(0, 0.78, -0.3);

  // --- the CRT head ------------------------------------------------------

  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Parented to the root, not the body: the stance twists, the screen does not.
  const head = new THREE.Group();
  head.position.y = 3.12;
  head.rotation.y = inward * CAMERA_YAW;
  group.add(head);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.15, 1.34),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide })
  );
  screen.position.z = 0.14;
  head.add(screen);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(2.36, 1.56, 0.26),
    new THREE.MeshStandardMaterial({
      color: 0x080d16,
      emissive: profile.accent,
      emissiveIntensity: 0.3,
      roughness: 0.45,
      metalness: 0.7
    })
  );
  bezel.castShadow = true;
  head.add(bezel);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), limbMaterial);
  neck.position.y = -0.9;
  head.add(neck);

  const glow = new THREE.PointLight(profile.accent, 5, 7, 2);
  glow.position.set(0, 0, 1.1);
  head.add(glow);

  let currentText = '';
  let redraw = true;
  let blinkOn = true;
  let blinkTimer = 0;

  function paint(): void {
    ctx.fillStyle = '#040810';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    ctx.fillStyle = hex(profile.color);
    ctx.fillRect(0, 0, SCREEN_W, 52);
    ctx.fillStyle = '#040810';
    ctx.font = 'bold 28px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(`▌${profile.name}`, 16, 27);
    ctx.fillText('— □ ×', SCREEN_W - 130, 27);

    ctx.font = '24px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = hex(profile.accent);
    const lines = wrap(currentText).slice(-MAX_LINES);
    lines.forEach((line, i) => ctx.fillText(line, 16, 92 + i * 34));

    if (blinkOn) {
      const last = lines[lines.length - 1] ?? '';
      const cursorX = 16 + ctx.measureText(last).width + 6;
      const cursorY = 92 + Math.max(0, lines.length - 1) * 34;
      ctx.fillRect(cursorX, cursorY - 12, 13, 25);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 52; y < SCREEN_H; y += 4) ctx.fillRect(0, y, SCREEN_W, 2);

    texture.needsUpdate = true;
  }
  paint();

  // --- pose state --------------------------------------------------------

  const current: Pose = { ...POSES.idle };
  let target: Pose = POSES.idle;
  let charge = 0;
  let flashAmount = 0;
  const phase = Math.random() * Math.PI * 2;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const leadFist = new THREE.Vector3();
  const rearFist = new THREE.Vector3();
  const leadFoot = new THREE.Vector3();
  const rearFoot = new THREE.Vector3();

  return {
    group,

    setPose(pose) {
      target = POSES[pose];
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
      return head.getWorldPosition(new THREE.Vector3());
    },

    update(dt, elapsed) {
      // Attacks snap out, everything else settles.
      const speed = target.punch > 0.5 ? 24 : 10;
      const t = 1 - Math.exp(-speed * Math.max(dt, 0.0001));
      for (const key of Object.keys(current) as (keyof Pose)[]) {
        current[key] = lerp(current[key], target[key], t);
      }

      const bob = Math.sin(elapsed * 2.4 + phase) * 0.05;
      const jitter = charge * 0.04 * Math.sin(elapsed * 40);

      group.position.x =
        baseX + (current.forward - current.recoil * 0.75 + jitter) * inward;
      group.position.y = -current.crouch * 0.3 - current.fallen * 0.45;
      group.rotation.z = current.fallen * 1.2 * inward;

      torso.position.y = 1.5 + bob - current.crouch * 0.24;
      // Body-local +Z points at the opponent, so a positive X rotation leans in.
      body.rotation.x = current.lean * 0.55;
      shoulders.position.y = 2.05 + bob - current.crouch * 0.2;

      head.position.y = 3.12 + bob * 1.3 - current.crouch * 0.36 - current.fallen * 0.5;
      head.position.x = current.lean * 0.5 * inward + current.forward * 0.25 * inward;
      head.rotation.z = -current.lean * 0.18 * inward - current.fallen * 0.6 * inward;

      // Fists live in body-local space, where +Z already points at the opponent.
      leadFist.set(
        0.12,
        1.72 + bob + current.guardUp * 0.42 + current.punch * 0.22,
        1.15 + current.punch * 1.5 - current.guardUp * 0.18
      );
      rearFist.set(
        -0.14,
        1.5 + bob * 0.7 + current.guardUp * 0.5,
        0.15 + current.guardUp * 0.85
      );
      fistLead.position.copy(leadFist);
      fistRear.position.copy(rearFist);
      fistLead.rotation.z = current.punch * 0.5;

      leadFoot.set(0, 0.13, 0.62 + current.forward * 0.4);
      rearFoot.set(0, 0.13, -0.58 + current.forward * 0.2);
      footLead.position.copy(leadFoot);
      footRear.position.copy(rearFoot);

      connect(armLead, shoulderLead, leadFist);
      connect(armRear, shoulderRear, rearFist);
      connect(legLead, hipLead, leadFoot);
      connect(legRear, hipRear, rearFoot);

      // The longer the reply, the hotter the fighter runs.
      bodyMaterial.emissiveIntensity = 0.22 + charge * 0.85 + flashAmount;
      limbMaterial.emissiveIntensity = 0.45 + charge * 0.7 + flashAmount * 2;
      glow.intensity = 5 + charge * 9 + flashAmount * 22;
      flashAmount *= 0.86;

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
