import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFx, SPECIAL_MOVE_FX, specialFxFor } from '../src/render/fx';
import type { Stage } from '../src/render/scene';
import { ROSTER } from '../src/fighters';

const IDS = [
  'CONSTITUTIONAL_BARRIER',
  'CONFIDENT_FABRICATION',
  'CONTEXT_WINDOW_SLAM',
  'FAST_INFERENCE'
] as const;

function stubStage() {
  const added: THREE.Object3D[] = [];
  const shakes: number[] = [];
  const scene = new THREE.Scene();
  const stage = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    add(object: THREE.Object3D) {
      added.push(object);
      scene.add(object);
    },
    onFrame() {},
    start() {},
    shake(amount: number) {
      shakes.push(amount);
    },
    hitstop() {},
    worldToScreen() {
      return { x: 0, y: 0 };
    },
    setFighterColors() {},
    zoomPunch() {}
  } as unknown as Stage;
  return { stage, added, shakes };
}

const layer = { appendChild() {} } as unknown as HTMLElement;

describe('special-move FX catalog', () => {
  it('covers exactly the four named special moves', () => {
    expect(Object.keys(SPECIAL_MOVE_FX).sort()).toEqual([...IDS].sort());
  });

  it('themes each special to its owner brand colour', () => {
    for (const id of IDS) {
      const spec = SPECIAL_MOVE_FX[id];
      expect(ROSTER[spec.owner], `${id} owner ${spec.owner}`).toBeDefined();
      expect(spec.color, id).toBe(ROSTER[spec.owner]!.color);
    }
    expect(new Set(IDS.map((id) => SPECIAL_MOVE_FX[id].color)).size).toBe(4);
  });

  it('gives each special a visually distinct shape and particle budget', () => {
    expect(new Set(IDS.map((id) => SPECIAL_MOVE_FX[id].shape)).size).toBe(4);
    expect(new Set(IDS.map((id) => SPECIAL_MOVE_FX[id].particleCount)).size).toBe(4);
    for (const id of IDS) {
      expect(SPECIAL_MOVE_FX[id].particleCount, id).toBeGreaterThan(0);
      expect(SPECIAL_MOVE_FX[id].ringCount, id).toBeGreaterThanOrEqual(1);
      expect(SPECIAL_MOVE_FX[id].durationS, id).toBeGreaterThan(0.5);
      expect(SPECIAL_MOVE_FX[id].shake, id).toBeGreaterThan(0);
    }
  });

  it('resolves a special from both its announcer name and its ability id', () => {
    for (const id of IDS) {
      const spec = SPECIAL_MOVE_FX[id];
      expect(specialFxFor(id)).toBe(spec);
      expect(specialFxFor(spec.moveName)).toBe(spec);
      expect(specialFxFor(spec.moveName.toLowerCase())).toBe(spec);
    }
    expect(specialFxFor('FINAL ARGUMENT')).toBeNull();
    expect(specialFxFor('')).toBeNull();
  });
});

describe('fx.special dispatch', () => {
  it('spawns themed 3D effects and shakes the stage when a special lands', () => {
    const { stage, added, shakes } = stubStage();
    const fx = createFx(stage, layer);

    expect(fx.activeSpecials()).toBe(0);
    const spec = fx.special(
      'CONTEXT WINDOW SLAM',
      new THREE.Vector3(1, 2, 0),
      new THREE.Vector3(-1, 2, 0)
    );

    expect(spec).not.toBeNull();
    expect(spec!.id).toBe('CONTEXT_WINDOW_SLAM');
    expect(fx.activeSpecials()).toBe(1);
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(shakes).toContain(spec!.shake);
    expect(added.some((o) => (o as THREE.Points).isPoints === true), 'particle burst').toBe(true);
    expect(added.some((o) => (o as THREE.Mesh).isMesh === true), 'expanding ring').toBe(true);
  });

  it('retires every special effect once its lifetime elapses', () => {
    const { stage, added } = stubStage();
    const fx = createFx(stage, layer);
    const spec = fx.special('FAST INFERENCE', new THREE.Vector3());
    expect(spec).not.toBeNull();

    for (let i = 0; i < 200; i++) fx.update(0.05);

    expect(fx.activeSpecials()).toBe(0);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((o) => o.parent === null), 'all effect objects detached').toBe(true);
  });

  it('ignores a move name that is not one of the four specials', () => {
    const { stage, added, shakes } = stubStage();
    const fx = createFx(stage, layer);
    expect(fx.special('FINAL ARGUMENT', new THREE.Vector3())).toBeNull();
    expect(fx.activeSpecials()).toBe(0);
    expect(added).toHaveLength(0);
    expect(shakes).toHaveLength(0);
  });

  it('keeps the plain hit burst working alongside specials', () => {
    const { stage, added } = stubStage();
    const fx = createFx(stage, layer);
    fx.burst(new THREE.Vector3(0, 1, 0), 0xffd166, 20, 5);
    expect(added).toHaveLength(1);
    expect(fx.activeSpecials()).toBe(0);
    for (let i = 0; i < 60; i++) fx.update(0.05);
    expect(added[0]!.parent).toBeNull();
  });
});
