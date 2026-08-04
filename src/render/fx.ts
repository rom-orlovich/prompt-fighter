/**
 * Impact effects: 3D spark bursts and the DOM damage numbers layered over them.
 * Kept separate from the stage so the arena stays declarative and this stays
 * throwaway/ephemeral — every burst removes itself when its life runs out.
 *
 * Also owns the four named special-move FX (one super per fighter) — bigger,
 * themed particle-burst + expanding-ring combos that shake the stage. `special()`
 * and `update()` stay DOM-free (no `document`, no `layer`) so this file unit-tests
 * under plain Node; only `damageNumber` touches the DOM.
 */

import * as THREE from 'three';
import type { Stage } from './scene';
import { ROSTER } from '../fighters';

interface Burst {
  points: THREE.Points;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

// --- special-move FX catalog -------------------------------------------------

export type SpecialMoveId =
  | 'CONSTITUTIONAL_BARRIER'
  | 'CONFIDENT_FABRICATION'
  | 'CONTEXT_WINDOW_SLAM'
  | 'FAST_INFERENCE';

export type SpecialShape = 'shield' | 'burst' | 'slam' | 'stutter';

export interface SpecialFxSpec {
  id: SpecialMoveId;
  /** The fighter that owns this special — a key into `ROSTER`. */
  owner: string;
  /** The announcer-facing move name, e.g. "CONSTITUTIONAL BARRIER". */
  moveName: string;
  /** Brand colour, sourced from `ROSTER[owner].color`. */
  color: number;
  shape: SpecialShape;
  particleCount: number;
  ringCount: number;
  durationS: number;
  shake: number;
}

export const SPECIAL_MOVE_FX: Record<SpecialMoveId, SpecialFxSpec> = {
  CONSTITUTIONAL_BARRIER: {
    id: 'CONSTITUTIONAL_BARRIER',
    owner: 'CLAUDE',
    moveName: 'CONSTITUTIONAL BARRIER',
    color: ROSTER.CLAUDE!.color,
    shape: 'shield',
    particleCount: 70,
    ringCount: 2,
    durationS: 0.9,
    shake: 4
  },
  CONFIDENT_FABRICATION: {
    id: 'CONFIDENT_FABRICATION',
    owner: 'CODEX',
    moveName: 'CONFIDENT FABRICATION',
    color: ROSTER.CODEX!.color,
    shape: 'burst',
    particleCount: 110,
    ringCount: 1,
    durationS: 0.75,
    shake: 7
  },
  CONTEXT_WINDOW_SLAM: {
    id: 'CONTEXT_WINDOW_SLAM',
    owner: 'GEMINI',
    moveName: 'CONTEXT WINDOW SLAM',
    color: ROSTER.GEMINI!.color,
    shape: 'slam',
    particleCount: 140,
    ringCount: 3,
    durationS: 1.1,
    shake: 9
  },
  FAST_INFERENCE: {
    id: 'FAST_INFERENCE',
    owner: 'LOCAL 7B',
    moveName: 'FAST INFERENCE',
    color: ROSTER['LOCAL 7B']!.color,
    shape: 'stutter',
    particleCount: 26,
    ringCount: 1,
    durationS: 0.85,
    shake: 5
  }
};

export const SPECIAL_MOVE_IDS: SpecialMoveId[] = [
  'CONSTITUTIONAL_BARRIER',
  'CONFIDENT_FABRICATION',
  'CONTEXT_WINDOW_SLAM',
  'FAST_INFERENCE'
];

/** Normalises spaces/dashes to underscores and upper-cases, so both the
 * announcer name ("CONTEXT WINDOW SLAM") and the ability id
 * ("CONTEXT_WINDOW_SLAM", any case) resolve to the same spec. Returns null for
 * anything that isn't one of the four named specials. */
export function specialFxFor(name: string): SpecialFxSpec | null {
  const key = name.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const spec = SPECIAL_MOVE_FX[key as SpecialMoveId];
  return spec ?? null;
}

// --- staggered mini-bursts (the `stutter` shape) ------------------------------

interface PendingMiniBurst {
  /** Seconds remaining before this mini-burst fires. */
  delay: number;
  position: THREE.Vector3;
  color: number;
}

interface ActiveSpecial {
  spec: SpecialFxSpec;
  /** Seconds elapsed since this special was spawned. */
  elapsed: number;
  pending: PendingMiniBurst[];
}

export interface Fx {
  burst(position: THREE.Vector3, color: number, count: number, power: number): void;
  damageNumber(position: THREE.Vector3, amount: number, crit: boolean): void;
  /** Spawns the named special's themed FX at `targetPosition` (and, when given,
   * a smaller directional cue burst at `sourcePosition`), shakes the stage
   * exactly once with `spec.shake`, and returns the resolved spec — or null
   * when `move` isn't one of the four named specials, in which case nothing is
   * spawned and the stage is not shaken. */
  special(move: string, targetPosition: THREE.Vector3, sourcePosition?: THREE.Vector3): SpecialFxSpec | null;
  /** Count of special-move effects still animating — including a `stutter`
   * special whose staggered mini-bursts haven't all fired and expired yet. */
  activeSpecials(): number;
  update(dt: number): void;
}

export function createFx(stage: Stage, layer: HTMLElement): Fx {
  const bursts: Burst[] = [];
  const rings: Ring[] = [];
  const activeSpecials: ActiveSpecial[] = [];

  function spawnBurst(position: THREE.Vector3, color: number, count: number, power: number, maxLife: number): void {
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * power,
          (Math.random() - 0.2) * power,
          (Math.random() - 0.5) * power * 0.6
        )
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: 0.16,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );

    stage.add(points);
    bursts.push({ points, velocities, life: 0, maxLife });
  }

  function spawnRing(
    position: THREE.Vector3,
    color: number,
    maxLife: number,
    startScale: number,
    endScale: number
  ): void {
    const geometry = new THREE.TorusGeometry(0.6, 0.06, 12, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(startScale);

    stage.add(mesh);
    rings.push({ mesh, life: 0, maxLife, startScale, endScale });
  }

  return {
    burst(position, color, count, power) {
      spawnBurst(position, color, count, power, 0.65);
    },

    damageNumber(position, amount, crit) {
      const { x, y } = stage.worldToScreen(position);
      const element = document.createElement('div');
      element.className = crit ? 'dmg crit' : 'dmg';
      element.textContent = String(amount);
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      layer.appendChild(element);
      setTimeout(() => element.remove(), 1000);
    },

    special(move, targetPosition, sourcePosition) {
      const spec = specialFxFor(move);
      if (!spec) return null;

      spawnBurst(targetPosition, spec.color, spec.particleCount, 7, spec.durationS);
      for (let r = 0; r < spec.ringCount; r++) {
        const stagger = r * 0.12;
        spawnRing(targetPosition, spec.color, spec.durationS - stagger, 0.4 + r * 0.3, 3.4 + r * 1.1);
      }

      if (sourcePosition) {
        spawnBurst(sourcePosition, spec.color, Math.round(spec.particleCount * 0.35), 4, spec.durationS * 0.7);
      }

      const pending: PendingMiniBurst[] = [];
      if (spec.shape === 'stutter') {
        for (const delay of [0.08, 0.16, 0.24]) {
          pending.push({ delay, position: targetPosition.clone(), color: spec.color });
        }
      }

      activeSpecials.push({ spec, elapsed: 0, pending });
      stage.shake(spec.shake);

      return spec;
    },

    activeSpecials() {
      return activeSpecials.length;
    },

    update(dt) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i]!;
        burst.life += dt;

        const attribute = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;

        for (let p = 0; p < burst.velocities.length; p++) {
          const velocity = burst.velocities[p]!;
          velocity.y -= 9.8 * dt * 0.35;
          array[p * 3] += velocity.x * dt;
          array[p * 3 + 1] += velocity.y * dt;
          array[p * 3 + 2] += velocity.z * dt;
        }
        attribute.needsUpdate = true;

        const material = burst.points.material as THREE.PointsMaterial;
        material.opacity = Math.max(0, 1 - burst.life / burst.maxLife);

        if (burst.life >= burst.maxLife) {
          burst.points.removeFromParent();
          burst.points.geometry.dispose();
          material.dispose();
          bursts.splice(i, 1);
        }
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]!;
        ring.life += dt;

        const t = Math.min(1, ring.life / ring.maxLife);
        const scale = ring.startScale + (ring.endScale - ring.startScale) * t;
        ring.mesh.scale.setScalar(scale);

        const material = ring.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = Math.max(0, 0.85 * (1 - t));

        if (ring.life >= ring.maxLife) {
          ring.mesh.removeFromParent();
          ring.mesh.geometry.dispose();
          material.dispose();
          rings.splice(i, 1);
        }
      }

      for (let i = activeSpecials.length - 1; i >= 0; i--) {
        const active = activeSpecials[i]!;
        active.elapsed += dt;

        for (let p = active.pending.length - 1; p >= 0; p--) {
          const mini = active.pending[p]!;
          mini.delay -= dt;
          if (mini.delay <= 0) {
            spawnBurst(mini.position, mini.color, 24, 5, 0.35);
            spawnRing(mini.position, mini.color, 0.3, 0.3, 1.6);
            active.pending.splice(p, 1);
          }
        }

        if (active.elapsed >= active.spec.durationS && active.pending.length === 0) {
          activeSpecials.splice(i, 1);
        }
      }
    }
  };
}
