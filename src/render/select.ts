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
import { createFighter, NEUTRAL_HALF_SPACING } from './fighter';
import type { FighterRig } from './fighter';

const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = 280;
const PREVIEW_FOV = 40;

/**
 * Fraction of the camera's vertical half-frame a fighter's own measured height
 * should fill, symmetric around its own vertical centre. Well inside 1 so every
 * card keeps headroom above the hair and footroom below the floor instead of
 * cropping either edge.
 */
const PREVIEW_FIT = 0.9;

/**
 * Solves the camera placement that fits a fighter's measured `[bottom, top]`
 * world-Y span into `fit` of the vertical frustum, centred on the span's own
 * midpoint. This is what makes the framing self-correcting: it reads the
 * fighter's ACTUAL rendered height (body + hair) rather than a constant tuned
 * against today's roster, so a future rescale re-frames the card instead of
 * silently cropping a head again — and because every fighter is solved against
 * the same `fit`, all four read at the same on-screen size regardless of how
 * tall they actually are.
 */
export function frameFighter(
  top: number,
  bottom: number,
  fovDeg: number = PREVIEW_FOV,
  fit: number = PREVIEW_FIT
): { cameraY: number; distance: number } {
  const halfFovRad = (fovDeg * Math.PI) / 360;
  const halfHeight = (top - bottom) / 2;
  return {
    cameraY: (top + bottom) / 2,
    distance: halfHeight / (fit * Math.tan(halfFovRad))
  };
}

interface CardEntry {
  name: FighterId;
  button: HTMLButtonElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: FighterRig;
  /** Set once `frameFighter` has been applied from a real measurement — after
   * that this card's camera is left alone (see `frame()`). */
  framed: boolean;
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

  // A reasonable placeholder until the rig's assets finish loading and
  // `frameFighter` re-poses this from a real measurement (see `frame()` below).
  const camera = new THREE.PerspectiveCamera(PREVIEW_FOV, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 30);
  camera.position.set(0, 1.9, 4.6);
  camera.lookAt(0, 1.55, 0);

  scene.add(new THREE.AmbientLight(0x3a4a68, 1.3));
  const key = new THREE.PointLight(profile.accent, 7, 12, 2);
  key.position.set(1.5, 3.1, 2.7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.85);
  rim.position.set(-2.4, 4, -3);
  scene.add(rim);

  // `createFighter` plants its root group at `side * NEUTRAL_HALF_SPACING` (see
  // fighter.ts). A holder offset to the mirror image of that cancels it out so
  // every preview is centered no matter which side the rig thinks it faces —
  // read from the constant rather than copied, because arena spacing is tuned
  // for the fight and has moved before.
  const holder = new THREE.Group();
  holder.position.x = NEUTRAL_HALF_SPACING;
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

    cards.push({ name, button, renderer, scene, camera, rig, framed: false });
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
      // One-time re-frame the instant a real measurement is available (both
      // the body and hair have settled — see `measuredBounds`). Skipped ever
      // after: nothing about a fighter's height changes post-load.
      if (!entry.framed) {
        const bounds = entry.rig.measuredBounds();
        if (bounds) {
          const { cameraY, distance } = frameFighter(bounds.top, bounds.bottom);
          entry.camera.position.set(0, cameraY, distance);
          entry.camera.lookAt(0, cameraY, 0);
          entry.framed = true;
        }
      }
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
