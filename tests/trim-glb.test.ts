import { describe, it, expect } from 'vitest';
import { trimGlb } from '../scripts/trim-glb.mjs';
import { validateGlbStructure } from '../scripts/validate-glb.mjs';
import { readGlb, packGltfToGlb } from '../scripts/gltf-to-glb.mjs';

function f32(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

function buildFixtureGlb() {
  const position = f32([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const inverseBindMatrices = f32(new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)));
  const waveInput = f32([0, 1]);
  const waveOutput = f32([0, 0, 0, 0, 1, 0]);
  const idleInput = f32([0, 1]);
  const idleOutput = f32([0, 0, 0, 1, 0, 0, 0, 1]);

  const parts = [position, inverseBindMatrices, waveInput, waveOutput, idleInput, idleOutput];
  const byteOffsets: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    byteOffsets.push(cursor);
    cursor += part.byteLength;
  }
  const bin = new Uint8Array(cursor);
  parts.forEach((part, i) => bin.set(part, byteOffsets[i]));

  const bufferViews = parts.map((part, i) => ({
    buffer: 0,
    byteOffset: byteOffsets[i],
    byteLength: part.byteLength
  }));

  const doc = {
    asset: { version: '2.0', generator: 'test-fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Root', children: [1] }, { name: 'Bone' }],
    meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'flat', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    skins: [{ name: 'Skin', joints: [1], inverseBindMatrices: 1 }],
    animations: [
      {
        name: 'Wave',
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
        samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }]
      },
      {
        name: 'Idle',
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
        samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }]
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 },
      { bufferView: 1, componentType: 5126, type: 'MAT4', count: 1 },
      { bufferView: 2, componentType: 5126, type: 'SCALAR', count: 2 },
      { bufferView: 3, componentType: 5126, type: 'VEC3', count: 2 },
      { bufferView: 4, componentType: 5126, type: 'SCALAR', count: 2 },
      { bufferView: 5, componentType: 5126, type: 'VEC4', count: 2 }
    ],
    bufferViews,
    buffers: [{ byteLength: bin.length }]
  };

  return packGltfToGlb(doc, bin);
}

describe('trimGlb', () => {
  it('produces a structurally valid GLB containing only the requested animation', () => {
    const source = buildFixtureGlb();
    const trimmed = trimGlb(source, ['Wave']);
    const result = validateGlbStructure(trimmed);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    const { json } = readGlb(trimmed);
    expect(json.animations).toHaveLength(1);
    expect(json.animations[0].name).toBe('Wave');
  });

  it('drops the accessors/bufferViews only used by the dropped animation', () => {
    const source = buildFixtureGlb();
    const { json: sourceJson } = readGlb(source);
    const trimmed = trimGlb(source, ['Wave']);
    const { json: trimmedJson } = readGlb(trimmed);
    expect(sourceJson.accessors).toHaveLength(6);
    expect(trimmedJson.accessors).toHaveLength(4);
    expect(trimmedJson.bufferViews).toHaveLength(4);
  });

  it('shrinks the total GLB byte size', () => {
    const source = buildFixtureGlb();
    const trimmed = trimGlb(source, ['Wave']);
    expect(trimmed.byteLength).toBeLessThan(source.byteLength);
  });

  it('still resolves the mesh and skin references correctly after re-indexing', () => {
    const source = buildFixtureGlb();
    const trimmed = trimGlb(source, ['Wave']);
    const { json, bin } = readGlb(trimmed);
    const posAccessorIdx = json.meshes[0].primitives[0].attributes.POSITION;
    const posAccessor = json.accessors[posAccessorIdx];
    expect(posAccessor.count).toBe(3);
    const posBv = json.bufferViews[posAccessor.bufferView];
    expect((posBv.byteOffset ?? 0) + posBv.byteLength).toBeLessThanOrEqual(bin.length);
    const ibmIdx = json.skins[0].inverseBindMatrices;
    expect(json.accessors[ibmIdx].type).toBe('MAT4');
  });

  it('throws when asked to keep an animation name that does not exist', () => {
    const source = buildFixtureGlb();
    expect(() => trimGlb(source, ['Wave', 'DoesNotExist'])).toThrow(/DoesNotExist/);
  });
});

describe('validateGlbStructure', () => {
  it('flags a GLB whose accessor references a bufferView that does not exist', () => {
    const source = buildFixtureGlb();
    const { json, bin } = readGlb(source);
    const corrupted = { ...json, accessors: [...json.accessors] };
    corrupted.accessors[0] = { ...corrupted.accessors[0], bufferView: 99 };
    const glb = packGltfToGlb(corrupted, bin);
    const result = validateGlbStructure(glb);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('bufferView 99'))).toBe(true);
  });
});
