/**
 * Impact effects: 3D spark bursts and the DOM damage numbers layered over them.
 * Kept separate from the stage so the arena stays declarative and this stays
 * throwaway/ephemeral — every burst removes itself when its life runs out.
 */

import * as THREE from 'three';
import type { Stage } from './scene';

interface Burst {
  points: THREE.Points;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

export interface Fx {
  burst(position: THREE.Vector3, color: number, count: number, power: number): void;
  damageNumber(position: THREE.Vector3, amount: number, crit: boolean): void;
  update(dt: number): void;
}

export function createFx(stage: Stage, layer: HTMLElement): Fx {
  const bursts: Burst[] = [];

  return {
    burst(position, color, count, power) {
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
      bursts.push({ points, velocities, life: 0, maxLife: 0.65 });
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
    }
  };
}
