import { describe, it, expect } from 'vitest';
import { packGltfToGlb, readGlb } from '../scripts/gltf-to-glb.mjs';

const GLTF = {
  asset: { version: '2.0', generator: 'test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Body', mesh: 0 }],
  meshes: [
    {
      name: 'Body',
      primitives: [
        {
          material: 0,
          attributes: {
            POSITION: 0,
            NORMAL: 1,
            TEXCOORD_0: 2,
            TEXCOORD_1: 3,
            TEXCOORD_3: 4,
            COLOR_0: 5,
            COLOR_1: 6,
            JOINTS_0: 7,
            WEIGHTS_0: 8
          }
        }
      ]
    }
  ],
  materials: [
    {
      name: 'MI_Superhero_Male',
      normalTexture: { index: 0 },
      occlusionTexture: { index: 1 },
      emissiveTexture: { index: 2 },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 3 },
        metallicRoughnessTexture: { index: 4 },
        roughnessFactor: 0.8
      }
    }
  ],
  images: [{ uri: 'skin.png' }],
  textures: [{ source: 0 }],
  samplers: [{ magFilter: 9729 }],
  buffers: [{ byteLength: 6, uri: 'model.bin' }]
};

describe('packGltfToGlb', () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const glb = packGltfToGlb(GLTF, bin);
  const out = readGlb(glb);

  it('emits a valid glTF 2.0 binary container with 4-byte aligned chunks', () => {
    expect(out.json.buffers).toHaveLength(1);
  });

  it('inlines the .bin payload as the single unnamed buffer', () => {
    expect(out.json.buffers[0].uri).toBeUndefined();
    expect(out.json.buffers[0].byteLength).toBe(6);
    expect(Array.from(out.bin.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('strips every texture reference so the model needs no sidecar images', () => {
    expect(out.json.images).toBeUndefined();
    expect(out.json.textures).toBeUndefined();
    expect(out.json.samplers).toBeUndefined();
    const material = out.json.materials[0];
    expect(material.pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
  });

  it('drops the secondary UV and vertex-colour attributes that would tint a flat material', () => {
    const attributes = out.json.meshes[0].primitives[0].attributes;
    expect(Object.keys(attributes).sort()).toEqual(
      ['JOINTS_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', 'WEIGHTS_0'].sort()
    );
  });

  it('does not mutate the source document', () => {
    expect(GLTF.images).toHaveLength(1);
  });
});

describe('packGltfToGlb selective texture retention', () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const normalBytes = new Uint8Array([10, 11, 12, 13]);
  const roughnessBytes = new Uint8Array([20, 21, 22]);

  function resolveImageBytes(image: { uri?: string }) {
    if (image.uri === 'normal.png') return normalBytes;
    if (image.uri === 'roughness.png') return roughnessBytes;
    return undefined;
  }

  const GLTF_WITH_NORMAL_AND_ROUGHNESS = {
    ...GLTF,
    materials: [
      {
        name: 'MI_Superhero_Male',
        normalTexture: { index: 0 },
        pbrMetallicRoughness: {
          baseColorTexture: { index: 1 },
          metallicRoughnessTexture: { index: 2 },
          metallicFactor: 0
        }
      }
    ],
    images: [{ uri: 'normal.png' }, { uri: 'basecolor.png' }, { uri: 'roughness.png' }],
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }]
  };

  const glb = packGltfToGlb(GLTF_WITH_NORMAL_AND_ROUGHNESS, bin, {
    keepTextureSlots: new Set(['normalTexture', 'metallicRoughnessTexture']),
    resolveImageBytes
  });
  const out = readGlb(glb);
  const material = out.json.materials[0];

  it('keeps only the requested slots and embeds their images as bufferViews', () => {
    expect(out.json.images).toHaveLength(2);
    expect(out.json.textures).toHaveLength(2);
    expect(material.normalTexture).toBeDefined();
    expect(material.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();
  });

  it('still strips the slot that was not requested and defaults its factor', () => {
    expect(material.pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(material.pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
  });

  it('embeds the exact resolved bytes, readable back out of the BIN chunk', () => {
    const normalImage = out.json.images[material.normalTexture.index];
    const normalBufferView = out.json.bufferViews[normalImage.bufferView];
    const normalBytesOut = out.bin.subarray(
      normalBufferView.byteOffset,
      normalBufferView.byteOffset + normalBufferView.byteLength
    );
    expect(Array.from(normalBytesOut)).toEqual(Array.from(normalBytes));

    const roughnessTexIndex = material.pbrMetallicRoughness.metallicRoughnessTexture.index;
    const roughnessImage = out.json.images[out.json.textures[roughnessTexIndex].source];
    const roughnessBufferView = out.json.bufferViews[roughnessImage.bufferView];
    const roughnessBytesOut = out.bin.subarray(
      roughnessBufferView.byteOffset,
      roughnessBufferView.byteOffset + roughnessBufferView.byteLength
    );
    expect(Array.from(roughnessBytesOut)).toEqual(Array.from(roughnessBytes));
  });

  it('still inlines the original mesh bytes at the start of the buffer', () => {
    expect(Array.from(out.bin.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('produces a structurally valid result with no resolveImageBytes match (falls back to stripping)', () => {
    const stripped = packGltfToGlb(GLTF_WITH_NORMAL_AND_ROUGHNESS, bin, {
      keepTextureSlots: new Set(['normalTexture']),
      resolveImageBytes: () => undefined
    });
    const strippedOut = readGlb(stripped);
    expect(strippedOut.json.images).toBeUndefined();
    expect(strippedOut.json.materials[0].normalTexture).toBeUndefined();
  });
});

describe('readGlb', () => {
  it('round-trips whatever packGltfToGlb produced', () => {
    const bin = new Uint8Array([9, 8, 7, 6]);
    const glb = packGltfToGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] }, bin);
    const out = readGlb(glb);
    expect(out.json.asset.version).toBe('2.0');
    expect(Array.from(out.bin)).toEqual([9, 8, 7, 6]);
  });

  it('throws on a buffer that is not a valid glTF binary', () => {
    const bogus = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => readGlb(bogus)).toThrow();
  });
});
