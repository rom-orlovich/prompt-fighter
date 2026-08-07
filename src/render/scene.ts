/**
 * The arena: renderer, camera, lighting and the frame loop.
 *
 * Owns two pieces of game feel that everything else borrows — `hitstop`, which
 * freezes simulation time without freezing the frame, and `shake`, a decaying
 * camera offset. Both are here rather than in fx.ts because they act on the camera
 * and the clock, which this module owns.
 */

import * as THREE from 'three';

const CAMERA_BASE = new THREE.Vector3(0, 3.25, 8.7);
const CAMERA_TARGET = new THREE.Vector3(0, 1.95, 0);

/**
 * Shake decay, expressed as a half-life in seconds rather than a per-frame
 * multiplier.
 *
 * The old `shakeAmount *= 0.86` ran once per rendered frame, so the same hit
 * shook for ~0.3s at 60fps and ~2s at 10fps — the effect was literally a
 * different length depending on the machine. A half-life integrated against the
 * real frame delta is framerate-independent, which is the only way the shake can
 * be tuned once and stay tuned.
 */
const SHAKE_HALF_LIFE_S = 0.1;
const ZOOM_HALF_LIFE_S = 0.11;

/**
 * How fast the shake oscillates, in radians per second. High enough to read as a
 * jolt rather than a camera drift.
 */
const SHAKE_FREQUENCY = 62;

/**
 * Hard ceiling on shake amplitude, in world units.
 *
 * The special-move catalog speaks in an abstract 1-10 intensity (`spec.shake`),
 * which the old per-frame decay flattened almost instantly. Integrated properly
 * a 9 would throw the camera nine units sideways — past the fighters entirely.
 * The clamp lets callers keep passing intensities while the camera stays in the
 * arena.
 *
 * Raised from the original 0.95 for G14 (`comboScale` in `main.ts`): a crit's
 * own base shake is already 0.85, so the old cap left almost no headroom for
 * a crit landing deep in a combo to escalate at all — streak 3 and streak 1
 * crits were clamping to nearly the same value. This is still very much a
 * ceiling — a crit at the streak-5 cap asks for 0.85 × 3.0 = 2.55 and still
 * gets clipped here — it just now engages at the top of the escalation curve
 * instead of muting the middle of it.
 */
const MAX_SHAKE = 1.6;

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The camera's resting world position — what `shake`/`zoomPunch` deviate from. */
  cameraRest: THREE.Vector3;
  add(object: THREE.Object3D): void;
  /**
   * `dt` is hit-stopped simulation time (zero while an impact is frozen);
   * `real` is the true frame delta, for effects that must keep moving through
   * a freeze — knockback and the shake itself.
   */
  onFrame(callback: (dt: number, elapsed: number, real: number) => void): void;
  /** Starts the rAF render loop (simulate + draw). */
  start(): void;
  /**
   * Starts a timer-driven loop that advances everything **except** the WebGL
   * draw. `?fast=1` uses this: the end-to-end suite still needs knockback,
   * shake and hit-stop to actually run so it can assert on them, but rendering
   * a real frame budget under a software rasteriser is what made the fast path
   * skip the loop entirely in the first place.
   */
  startSimulation(): void;
  shake(amount: number): void;
  hitstop(ms: number): void;
  worldToScreen(position: THREE.Vector3): { x: number; y: number };
  setFighterColors(left: number, right: number): void;
  zoomPunch(amount: number): void;
  /**
   * The current shake/zoom envelope's magnitude — the deterministic amplitude
   * `camera.position` is oscillating and jittering within, with the ~62rad/s
   * oscillation phase and the per-frame `Math.random()` jitter both stripped
   * out (G14).
   *
   * `window.__pf.contacts[i].cameraPeak` used to sample raw `camera.position`
   * every rendered frame and keep the max — which meant catching the actual
   * peak depended on a render happening to land near a sin-wave crest inside
   * a ~100ms oscillation period. Fine at 60fps; under real contention
   * (parallel headed browsers competing for one GPU) frames get sparse enough
   * that a genuinely bigger, escalated blow could still get under-sampled and
   * read as smaller than an easier, earlier one — the escalation is real but
   * the measurement of it was frame-rate luck. This envelope is set
   * synchronously by `shake()`/`zoomPunch()` and decays smoothly, so even a
   * single sample shortly after an impact reads close to the true peak,
   * independent of how many frames actually rendered in between.
   */
  shakeIntensity(): number;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.032);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.copy(CAMERA_BASE);
  camera.lookAt(CAMERA_TARGET);

  // --- arena -------------------------------------------------------------

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.32, metalness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(80, 56, 0x2a3550, 0x151d30);
  grid.position.y = 0.01;
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.4;
  scene.add(grid);

  // A ring on the floor frames the fight and gives the eye a horizon to sit on.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.2, 0.045, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.55 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // A ring of tall emissive bars reads as a crowd/skyline through the fog.
  const pillars = new THREE.Group();
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2;
    const radius = 17 + Math.sin(i * 2.7) * 2.5;
    const height = 3 + ((i * 7) % 9);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, height, 0.35),
      new THREE.MeshStandardMaterial({
        color: 0x0a1020,
        emissive: i % 3 === 0 ? 0x2b4a7a : 0x123055,
        emissiveIntensity: 1.4
      })
    );
    bar.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius - 4);
    pillars.add(bar);
  }
  scene.add(pillars);

  // --- lighting ----------------------------------------------------------

  const ambient = new THREE.AmbientLight(0x33445f, 1.1);
  scene.add(ambient);

  // G21: narrower cone + tighter penumbra than before (was PI/5, 0.45) — a
  // more raking, more defined key light is what actually makes G15's restored
  // normal/roughness maps catch light as musculature instead of a soft, even
  // wash. Intensity bumped to compensate for the narrower cone covering less
  // of the arena.
  const keyLeft = new THREE.SpotLight(0xd97757, 105, 40, Math.PI / 6, 0.35, 1.4);
  keyLeft.position.set(-6, 10, 7);
  keyLeft.castShadow = true;
  keyLeft.shadow.mapSize.set(1024, 1024);
  scene.add(keyLeft);

  const keyRight = new THREE.SpotLight(0x10a37f, 105, 40, Math.PI / 6, 0.35, 1.4);
  keyRight.position.set(6, 10, 7);
  keyRight.castShadow = true;
  keyRight.shadow.mapSize.set(1024, 1024);
  scene.add(keyRight);

  // G21: stronger backlight — was 1.6 — so the silhouette separates from the
  // dark background harder, which is what makes the per-fighter rim glow
  // (see `attachRimShader` in `fighter.ts`) read as an edge ON something
  // already lit, not a glow floating in void.
  const rim = new THREE.DirectionalLight(0x88aaff, 2.0);
  rim.position.set(0, 6, -12);
  scene.add(rim);

  // --- loop --------------------------------------------------------------

  const callbacks: ((dt: number, elapsed: number, real: number) => void)[] = [];
  const clock = new THREE.Clock();
  let elapsed = 0;
  let shakeAmount = 0;
  let shakePhase = 0;
  let hitstopRemaining = 0;
  let zoom = 0;
  let running = false;

  /**
   * Advances simulation, hit-stop, shake and the camera by `rawInput` seconds
   * (already clamped by the caller). Never draws. Split out from `step()` so
   * `startSimulation()` can drive it with a caught-up delta instead of always
   * reading `clock.getDelta()` itself — see `startSimulation` below for why.
   */
  function stepBy(rawInput: number): void {
    const raw = rawInput;

    let dt = raw;
    if (hitstopRemaining > 0) {
      hitstopRemaining -= raw * 1000;
      dt = 0; // freeze simulation, keep rendering — the impact "sticks"
    }
    elapsed += dt;
    for (const cb of callbacks) cb(dt, elapsed, raw);

    // Shake and zoom run on REAL time: a hit-stop should hold the pose and let
    // the camera keep rattling, not freeze the whole picture solid.
    shakeAmount *= Math.pow(0.5, raw / SHAKE_HALF_LIFE_S);
    zoom *= Math.pow(0.5, raw / ZOOM_HALF_LIFE_S);
    shakePhase += raw * SHAKE_FREQUENCY;

    // Mostly deterministic oscillation with a little noise on top. Pure
    // `Math.random()` (the old approach) made the peak deviation a coin flip,
    // so a "big" shake could land on a frame that barely moved the camera.
    camera.position.set(
      CAMERA_BASE.x + Math.sin(shakePhase) * shakeAmount * 0.85 + (Math.random() - 0.5) * shakeAmount * 0.3,
      CAMERA_BASE.y + Math.cos(shakePhase * 1.43) * shakeAmount * 0.7 + (Math.random() - 0.5) * shakeAmount * 0.25,
      CAMERA_BASE.z + Math.sin(shakePhase * 0.77) * shakeAmount * 0.35 - zoom
    );
    camera.lookAt(CAMERA_TARGET);
  }

  /** `requestAnimationFrame` path: one real frame's delta, straight from the clock. */
  function step(): void {
    stepBy(Math.min(clock.getDelta(), 0.05));
  }

  function frame(): void {
    requestAnimationFrame(frame);
    step();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    cameraRest: CAMERA_BASE.clone(),
    add: (object) => scene.add(object),
    onFrame: (cb) => callbacks.push(cb),
    start: () => {
      if (running) return;
      running = true;
      clock.getDelta();
      frame();
    },
    // `?fast=1` (no `draw=1`) runs the simulation off a plain `setInterval`
    // instead of `requestAnimationFrame` — no canvas to paint, so nothing to
    // sync to. Under CPU contention (many parallel headless Chromium instances
    // fighting for the main thread — exactly what `fullyParallel` e2e runs
    // produce) `setInterval` ticks get delayed and bunched up; naively calling
    // `step()` once per tick would each time only advance by the 0.05s clamp,
    // so the simulated clock would silently fall behind real wall-clock time
    // the longer contention lasts. Assertions that measure recovery via real
    // time (`performance.now()`) against a fixed budget would then see a match
    // that "hasn't recovered yet" even though, in simulated time, it has.
    // Instead: read the REAL elapsed delta once per tick and consume it in
    // bounded 0.05s substeps, catching the simulated clock up to real time no
    // matter how sparsely the interval actually fired.
    startSimulation: () => {
      if (running) return;
      running = true;
      clock.getDelta();
      window.setInterval(() => {
        let remaining = clock.getDelta();
        // Never burn more than ~10s of catch-up in a single tick — that's a
        // backgrounded/paused tab, not "the tab is just slow", and running
        // thousands of substeps synchronously would itself stall the thread.
        let guard = 200;
        while (remaining > 1e-6 && guard-- > 0) {
          const sub = Math.min(remaining, 0.05);
          stepBy(sub);
          remaining -= sub;
        }
      }, 16);
    },
    shake: (amount) => {
      shakeAmount = Math.min(MAX_SHAKE, Math.max(shakeAmount, amount));
    },
    hitstop: (ms) => {
      hitstopRemaining = Math.max(hitstopRemaining, ms);
    },
    zoomPunch: (amount) => {
      zoom = Math.max(zoom, amount);
    },
    shakeIntensity: () => Math.hypot(shakeAmount * 0.85, shakeAmount * 0.7, zoom),
    worldToScreen: (position) => {
      const projected = position.clone().project(camera);
      return {
        x: (projected.x * 0.5 + 0.5) * window.innerWidth,
        y: (-projected.y * 0.5 + 0.5) * window.innerHeight
      };
    },
    setFighterColors: (left, right) => {
      keyLeft.color.setHex(left);
      keyRight.color.setHex(right);
    }
  };
}
