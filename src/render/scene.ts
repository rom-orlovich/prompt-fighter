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

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  add(object: THREE.Object3D): void;
  onFrame(callback: (dt: number, elapsed: number) => void): void;
  start(): void;
  shake(amount: number): void;
  hitstop(ms: number): void;
  worldToScreen(position: THREE.Vector3): { x: number; y: number };
  setFighterColors(left: number, right: number): void;
  zoomPunch(amount: number): void;
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

  const keyLeft = new THREE.SpotLight(0xd97757, 90, 40, Math.PI / 5, 0.45, 1.4);
  keyLeft.position.set(-6, 10, 7);
  keyLeft.castShadow = true;
  keyLeft.shadow.mapSize.set(1024, 1024);
  scene.add(keyLeft);

  const keyRight = new THREE.SpotLight(0x10a37f, 90, 40, Math.PI / 5, 0.45, 1.4);
  keyRight.position.set(6, 10, 7);
  keyRight.castShadow = true;
  keyRight.shadow.mapSize.set(1024, 1024);
  scene.add(keyRight);

  const rim = new THREE.DirectionalLight(0x88aaff, 1.6);
  rim.position.set(0, 6, -12);
  scene.add(rim);

  // --- loop --------------------------------------------------------------

  const callbacks: ((dt: number, elapsed: number) => void)[] = [];
  const clock = new THREE.Clock();
  let elapsed = 0;
  let shakeAmount = 0;
  let hitstopRemaining = 0;
  let zoom = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    const raw = Math.min(clock.getDelta(), 0.05);

    let dt = raw;
    if (hitstopRemaining > 0) {
      hitstopRemaining -= raw * 1000;
      dt = 0; // freeze simulation, keep rendering — the impact "sticks"
    }
    elapsed += dt;
    for (const cb of callbacks) cb(dt, elapsed);

    shakeAmount *= 0.86;
    zoom *= 0.88;
    camera.position.set(
      CAMERA_BASE.x + (Math.random() - 0.5) * shakeAmount,
      CAMERA_BASE.y + (Math.random() - 0.5) * shakeAmount,
      CAMERA_BASE.z + (Math.random() - 0.5) * shakeAmount * 0.5 - zoom
    );
    camera.lookAt(CAMERA_TARGET);

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
    add: (object) => scene.add(object),
    onFrame: (cb) => callbacks.push(cb),
    start: () => frame(),
    shake: (amount) => {
      shakeAmount = Math.max(shakeAmount, amount);
    },
    hitstop: (ms) => {
      hitstopRemaining = Math.max(hitstopRemaining, ms);
    },
    zoomPunch: (amount) => {
      zoom = Math.max(zoom, amount);
    },
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
