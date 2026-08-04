/**
 * Character-select screen: one interactive preview per fighter.
 *
 * Each card gets its own tiny Three.js scene so the thing the player picks is the
 * actual `createFighter` rig the arena uses — not a static portrait — while a
 * single shared `requestAnimationFrame` loop drives every card's pose animation
 * and render, so four live previews cost one rAF callback, not four.
 */

import * as THREE from 'three';
import { ROSTER } from '../fighters';
import type { FighterProfile } from '../fighters';
import { FIGHTER_IDS } from '../engine/selection';
import type { FighterId } from '../engine/selection';
import { ABILITIES, abilitiesFor } from '../engine/abilities';
import { createFighter } from './fighter';
import type { FighterRig } from './fighter';

const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = 280;

interface CardEntry {
  name: FighterId;
  button: HTMLButtonElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: FighterRig;
}

export interface SelectScreenOptions {
  /** Fired the moment a card is clicked — the player's chosen fighter for p1. */
  onPick?(name: FighterId): void;
}

export interface SelectScreen {
  el: HTMLElement;
  /** Marks the two fighters currently in the ring; pass null to clear a side. */
  highlight(p1: string | null, p2: string | null): void;
  /** Stops the shared render loop and releases every card's WebGL context. */
  dispose(): void;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Builds one card's throwaway scene: a couple of lights plus the fighter rig,
 * centered regardless of which way `createFighter` thinks it is facing. */
function buildPreviewScene(profile: FighterProfile): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: FighterRig;
} {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 30);
  camera.position.set(0, 1.9, 4.6);
  camera.lookAt(0, 1.55, 0);

  scene.add(new THREE.AmbientLight(0x3a4a68, 1.3));
  const key = new THREE.PointLight(profile.accent, 7, 12, 2);
  key.position.set(1.5, 3.1, 2.7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.85);
  rim.position.set(-2.4, 4, -3);
  scene.add(rim);

  // `createFighter` always plants its root group at x = side * 2.55 (see
  // fighter.ts). A holder offset to the mirror-image +2.55 cancels that out so
  // every preview is centered no matter which side the rig thinks it faces.
  const holder = new THREE.Group();
  holder.position.x = 2.55;
  const rig = createFighter(profile, -1);
  holder.add(rig.group);
  scene.add(holder);

  return { scene, camera, rig };
}

export function createSelectScreen(container: HTMLElement, options: SelectScreenOptions = {}): SelectScreen {
  container.innerHTML = '';

  const cards: CardEntry[] = [];

  for (const name of FIGHTER_IDS) {
    const profile = ROSTER[name]!;
    const visual = profile.visual;
    const abilities = abilitiesFor(name).map((id) => ABILITIES[id].name);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-card';
    button.dataset.fighter = profile.name;
    button.dataset.color = hex(visual.color);
    button.dataset.accent = hex(visual.accent);
    button.dataset.head = visual.headShape;
    button.dataset.silhouette = visual.silhouette;
    button.dataset.scale = String(visual.scale);
    button.dataset.abilities = abilities.join(',');

    const canvas = document.createElement('canvas');
    canvas.className = 'fighter-preview';
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    button.appendChild(canvas);

    const label = document.createElement('div');
    label.className = 'fighter-card-label';
    label.innerHTML = `<b>${profile.name}</b><i>${profile.tagline}</i>`;
    button.appendChild(label);

    const abilityList = document.createElement('div');
    abilityList.className = 'fighter-card-abilities';
    abilityList.textContent = abilities.join(' · ');
    button.appendChild(abilityList);

    button.addEventListener('click', () => {
      for (const entry of cards) entry.button.classList.toggle('selected', entry.name === name);
      options.onPick?.(name);
    });

    container.appendChild(button);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);

    const { scene, camera, rig } = buildPreviewScene(profile);
    rig.setPose('idle');
    rig.setScreenText(profile.name);

    cards.push({ name, button, renderer, scene, camera, rig });
  }

  // One shared rAF loop drives every card — four live previews, one callback.
  let running = true;
  let frameHandle = 0;
  const clock = new THREE.Clock();

  function frame(): void {
    if (!running) return;
    frameHandle = requestAnimationFrame(frame);

    // Once the title screen is hidden (a match is in progress) the grid — and
    // its four live WebGL contexts — sits behind `display: none`. Skip the
    // update/render work entirely while that's true: rendering an invisible
    // canvas wastes real main-thread time it cannot afford to spend, since a
    // match's turn pacing shares this same single-threaded event loop.
    if (container.offsetParent === null) {
      clock.getDelta(); // keep dt sane for the next visible frame
      return;
    }

    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.getElapsedTime();
    for (const entry of cards) {
      entry.rig.update(dt, elapsed);
      entry.renderer.render(entry.scene, entry.camera);
    }
  }
  frameHandle = requestAnimationFrame(frame);

  return {
    el: container,

    highlight(p1, p2) {
      for (const entry of cards) {
        entry.button.classList.toggle('is-p1', entry.name === p1);
        entry.button.classList.toggle('is-p2', entry.name === p2);
      }
    },

    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      for (const entry of cards) {
        entry.renderer.dispose();
        entry.renderer.forceContextLoss();
      }
      cards.length = 0;
      container.innerHTML = '';
    }
  };
}
