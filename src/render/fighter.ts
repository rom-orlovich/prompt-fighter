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
import type { FighterPart, GeometrySpec } from './fighter-plan';
import { buildFighterPlan } from './fighter-plan';

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

const FORWARD = new THREE.Vector3(0, 0, 1);

/** Stretch a unit-length box between two local-space points. */
function connect(limb: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const delta = to.clone().sub(from);
  const length = delta.length();
  limb.position.copy(from).addScaledVector(delta, 0.5);
  limb.quaternion.setFromUnitVectors(FORWARD, delta.normalize());
  limb.scale.z = Math.max(length, 0.001);
}

/** Build a Three.js geometry from a pure `GeometrySpec` (see `fighter-plan.ts`). */
function geometryFor(spec: GeometrySpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case 'box':
      return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2] ?? spec.size[1]);
    case 'sphere':
      return new THREE.SphereGeometry(spec.size[0], 20, 16);
    case 'octahedron':
      return new THREE.OctahedronGeometry(spec.size[0], 0);
    case 'torus':
      return new THREE.TorusGeometry(spec.size[0], spec.size[1], 12, 28);
    case 'plane':
      return new THREE.PlaneGeometry(spec.size[0], spec.size[1]);
  }
}

export function createFighter(profile: FighterProfile, side: -1 | 1): FighterRig {
  // `inward` points from this fighter toward the opponent.
  const inward = -side;
  const baseX = side * 2.55;
  const visual = profile.visual;

  // The pure geometry plan (roster/visuals.ts -> render/fighter-plan.ts) is the only
  // place fighter shape/size/material numbers come from — this function just turns
  // each named part into a real Three.js mesh.
  const plan = buildFighterPlan(visual);
  const partsByName = new Map(plan.map((p) => [p.name, p]));
  function part(name: string): FighterPart {
    const found = partsByName.get(name);
    if (!found) throw new Error(`fighter plan missing part: ${name}`);
    return found;
  }

  const group = new THREE.Group();
  group.position.set(baseX, 0, 0);
  group.scale.setScalar(visual.scale);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: visual.color,
    emissive: visual.color,
    emissiveIntensity: 0.22,
    roughness: 0.4,
    metalness: 0.6
  });
  const limbMaterial = new THREE.MeshStandardMaterial({
    color: 0x121a2b,
    emissive: visual.accent,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.75
  });
  const fistMaterial = new THREE.MeshStandardMaterial({
    color: visual.accent,
    emissive: visual.accent,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.5
  });
  const bezelMaterial = new THREE.MeshStandardMaterial({
    color: 0x080d16,
    emissive: visual.accent,
    emissiveIntensity: 0.3,
    roughness: 0.45,
    metalness: 0.7
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: visual.trim,
    emissive: visual.trim,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.65
  });

  // Body twists into a 3/4 stance so the silhouette reads as a fighter, not a box.
  const body = new THREE.Group();
  body.rotation.y = inward * 0.7;
  group.add(body);

  const torso = new THREE.Mesh(geometryFor(part('torso').geometry), bodyMaterial);
  torso.position.y = 1.5;
  torso.castShadow = true;
  body.add(torso);

  const shoulders = new THREE.Mesh(geometryFor(part('shoulders').geometry), limbMaterial);
  shoulders.position.y = 2.05;
  shoulders.castShadow = true;
  body.add(shoulders);

  const hips = new THREE.Mesh(geometryFor(part('hips').geometry), limbMaterial);
  hips.position.y = part('hips').position[1];
  hips.castShadow = true;
  body.add(hips);

  const fistLead = new THREE.Mesh(geometryFor(part('fistLead').geometry), fistMaterial);
  const fistRear = new THREE.Mesh(geometryFor(part('fistRear').geometry), fistMaterial);
  fistLead.castShadow = true;
  fistRear.castShadow = true;
  body.add(fistLead, fistRear);

  const armLead = new THREE.Mesh(geometryFor(part('armLead').geometry), limbMaterial);
  const armRear = new THREE.Mesh(geometryFor(part('armRear').geometry), limbMaterial);
  body.add(armLead, armRear);

  const footLead = new THREE.Mesh(geometryFor(part('footLead').geometry), limbMaterial);
  const footRear = new THREE.Mesh(geometryFor(part('footRear').geometry), limbMaterial);
  footLead.castShadow = true;
  footRear.castShadow = true;
  body.add(footLead, footRear);

  const legLead = new THREE.Mesh(geometryFor(part('legLead').geometry), limbMaterial);
  const legRear = new THREE.Mesh(geometryFor(part('legRear').geometry), limbMaterial);
  body.add(legLead, legRear);

  const shoulderLead = new THREE.Vector3(0, 2.02, 0.42);
  const shoulderRear = new THREE.Vector3(0, 1.98, -0.46);
  const hipLead = new THREE.Vector3(0, 0.78, 0.3);
  const hipRear = new THREE.Vector3(0, 0.78, -0.3);

  // --- the CRT head ------------------------------------------------------

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

  // Parented to the root, not the body: the stance twists, the screen does not.
  const head = new THREE.Group();
  head.position.y = 3.12;
  head.rotation.y = inward * CAMERA_YAW;
  group.add(head);

  const screenPart = part('screen');
  const screen = new THREE.Mesh(
    geometryFor(screenPart.geometry),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide })
  );
  screen.position.z = screenPart.position[2];
  head.add(screen);

  const bezelPart = part('bezel');
  const bezel = new THREE.Mesh(geometryFor(bezelPart.geometry), bezelMaterial);
  bezel.position.set(bezelPart.position[0], bezelPart.position[1], bezelPart.position[2]);
  bezel.castShadow = true;
  head.add(bezel);

  const neckPart = part('neck');
  const neck = new THREE.Mesh(geometryFor(neckPart.geometry), limbMaterial);
  neck.position.set(neckPart.position[0], neckPart.position[1], neckPart.position[2]);
  head.add(neck);

  // The headline visual variety: box / three stacked slabs / octahedron+torus-crest /
  // sphere, picked per-fighter by `visual.headShape` (see `HEAD_GEOMETRY` in
  // fighter-plan.ts). None of these pieces are ever repositioned in update() — they
  // just ride along with the head group, same as the bezel.
  for (const headPart of plan.filter((p) => p.role === 'head' || p.role === 'crest')) {
    const mesh = new THREE.Mesh(geometryFor(headPart.geometry), headMaterial);
    mesh.position.set(headPart.position[0], headPart.position[1], headPart.position[2]);
    mesh.castShadow = true;
    head.add(mesh);
  }

  const glow = new THREE.PointLight(visual.accent, 5, 7, 2);
  glow.position.set(0, 0, 1.1);
  head.add(glow);

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
