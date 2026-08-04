// Zero-dependency glTF (.gltf + .bin) -> glTF-2.0 GLB packer.
//
// By default strips every image/texture/sampler reference (most vendored assets in
// this project use flat, brand-tinted materials with no surface maps), drops
// secondary UV sets (TEXCOORD_1..n) and vertex-colour attributes (COLOR_n) that
// would otherwise tint a flat material, inlines the .bin payload as the document's
// single unnamed buffer, and emits a 4-byte-aligned binary glTF container per the
// glTF-2.0 GLB spec:
// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format-specification
//
// `opts.keepTextureSlots` (a Set of material texture-slot names: 'normalTexture',
// 'occlusionTexture', 'emissiveTexture', 'baseColorTexture', 'metallicRoughnessTexture')
// plus `opts.resolveImageBytes(image, imageIndex) => Uint8Array | undefined` lets a
// caller selectively SURVIVE specific slots — e.g. keep the normal and
// metallic-roughness maps for surface detail while still stripping the base-colour
// map so a brand tint stays a flat, readable colour. Surviving images are embedded
// as bufferView-backed images appended after the mesh binary, so the output is
// still a single self-contained GLB. Every other slot, and every slot when
// `resolveImageBytes` returns nothing for it, is stripped exactly as before.

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const GLB_HEADER_LENGTH = 12;
const CHUNK_HEADER_LENGTH = 8;

/**
 * Material texture-slot descriptors: where each slot lives on a material, and the
 * key used to look it up in `opts.keepTextureSlots`.
 */
const TEXTURE_SLOTS = [
  { holder: (material) => material, key: 'normalTexture' },
  { holder: (material) => material, key: 'occlusionTexture' },
  { holder: (material) => material, key: 'emissiveTexture' },
  { holder: (material) => (material.pbrMetallicRoughness ??= {}), key: 'baseColorTexture' },
  { holder: (material) => (material.pbrMetallicRoughness ??= {}), key: 'metallicRoughnessTexture' }
];

/**
 * @param {Record<string, unknown>} gltf
 * @param {Uint8Array} bin
 * @param {{
 *   keepTextureSlots?: Set<string>,
 *   resolveImageBytes?: (image: Record<string, unknown>, imageIndex: number) => Uint8Array | undefined
 * }} [opts]
 * @returns {Uint8Array}
 */
export function packGltfToGlb(gltf, bin, opts = {}) {
  const doc = deepClone(gltf);
  const keepTextureSlots = opts.keepTextureSlots ?? new Set();
  const resolveImageBytes = opts.resolveImageBytes;

  const sourceImages = gltf.images ?? [];
  const sourceTextures = gltf.textures ?? [];

  /** sourceImageIndex -> {bytes, mimeType} for every slot selected for retention. */
  const keptImages = new Map();
  /** texRefs (on the cloned doc) still pointing at an old texture index, to fix up once the new arrays exist. */
  const pendingRemap = [];

  for (const material of doc.materials ?? []) {
    for (const { holder, key } of TEXTURE_SLOTS) {
      const container = holder(material);
      const texRef = container[key];
      if (!texRef || texRef.index === undefined) continue;

      const sourceImageIndex = sourceTextures[texRef.index]?.source;
      const sourceImage = sourceImageIndex === undefined ? undefined : sourceImages[sourceImageIndex];
      const bytes =
        keepTextureSlots.has(key) && sourceImage && resolveImageBytes
          ? resolveImageBytes(sourceImage, sourceImageIndex)
          : undefined;

      if (bytes) {
        keptImages.set(sourceImageIndex, { bytes, mimeType: sourceImage.mimeType ?? 'image/png' });
        pendingRemap.push({ texRef, sourceImageIndex });
      } else {
        delete container[key];
      }
    }
    const pbr = (material.pbrMetallicRoughness ??= {});
    if (!pbr.baseColorTexture) pbr.baseColorFactor ??= [1, 1, 1, 1];
  }

  // Every image/texture/sampler reference not explicitly kept above is gone.
  delete doc.images;
  delete doc.textures;
  delete doc.samplers;

  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const attributeName of Object.keys(primitive.attributes ?? {})) {
        if (/^(TEXCOORD_[1-9]\d*|COLOR_\d+)$/.test(attributeName)) {
          delete primitive.attributes[attributeName];
        }
      }
    }
  }

  // Append any kept images after the mesh binary as bufferView-backed images, so
  // the GLB stays one self-contained file.
  const binParts = [bin];
  let cursor = bin.length;

  if (keptImages.size > 0) {
    const orderedSourceIndices = [...keptImages.keys()].sort((a, b) => a - b);
    const textureIndexBySourceImage = new Map();
    doc.images = [];
    doc.textures = [];
    doc.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    doc.bufferViews = [...(doc.bufferViews ?? [])];

    for (const sourceImageIndex of orderedSourceIndices) {
      const { bytes, mimeType } = keptImages.get(sourceImageIndex);
      const padding = (4 - (cursor % 4)) % 4;
      if (padding > 0) {
        binParts.push(new Uint8Array(padding));
        cursor += padding;
      }
      const byteOffset = cursor;
      binParts.push(bytes);
      cursor += bytes.length;

      const bufferViewIndex = doc.bufferViews.length;
      doc.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });

      const imageIndex = doc.images.length;
      doc.images.push({ mimeType, bufferView: bufferViewIndex });
      doc.textures.push({ sampler: 0, source: imageIndex });
      textureIndexBySourceImage.set(sourceImageIndex, doc.textures.length - 1);
    }

    for (const { texRef, sourceImageIndex } of pendingRemap) {
      texRef.index = textureIndexBySourceImage.get(sourceImageIndex);
    }
  }

  const combinedBin = binParts.length === 1 ? binParts[0] : concatBytes(binParts);

  // Inline the .bin payload as the single unnamed (GLB-embedded) buffer.
  doc.buffers = [{ byteLength: combinedBin.length }];

  const jsonChunk = padChunk(Buffer.from(JSON.stringify(doc), 'utf8'), 0x20);
  const binChunk = padChunk(Buffer.from(combinedBin), 0x00);

  const totalLength =
    GLB_HEADER_LENGTH +
    CHUNK_HEADER_LENGTH +
    jsonChunk.length +
    CHUNK_HEADER_LENGTH +
    binChunk.length;

  const out = Buffer.alloc(totalLength);
  let offset = 0;

  out.writeUInt32LE(GLB_MAGIC, offset); offset += 4;
  out.writeUInt32LE(GLB_VERSION, offset); offset += 4;
  out.writeUInt32LE(totalLength, offset); offset += 4;

  out.writeUInt32LE(jsonChunk.length, offset); offset += 4;
  out.writeUInt32LE(CHUNK_TYPE_JSON, offset); offset += 4;
  jsonChunk.copy(out, offset); offset += jsonChunk.length;

  out.writeUInt32LE(binChunk.length, offset); offset += 4;
  out.writeUInt32LE(CHUNK_TYPE_BIN, offset); offset += 4;
  binChunk.copy(out, offset); offset += binChunk.length;

  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Parses a binary GLB buffer back into {json, bin} — the inverse of packGltfToGlb.
 * @param {Uint8Array} glb
 * @returns {{json: Record<string, unknown>, bin: Uint8Array}}
 */
export function readGlb(glb) {
  const buf = Buffer.isBuffer(glb) ? glb : Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);

  if (buf.length < GLB_HEADER_LENGTH) {
    throw new Error('Invalid GLB: buffer too short for header');
  }

  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    throw new Error('Invalid GLB: bad magic bytes');
  }

  let offset = GLB_HEADER_LENGTH;

  if (offset + CHUNK_HEADER_LENGTH > buf.length) {
    throw new Error('Invalid GLB: missing JSON chunk header');
  }
  const jsonChunkLength = buf.readUInt32LE(offset); offset += 4;
  const jsonChunkType = buf.readUInt32LE(offset); offset += 4;
  if (jsonChunkType !== CHUNK_TYPE_JSON) {
    throw new Error('Invalid GLB: first chunk is not JSON');
  }
  if (offset + jsonChunkLength > buf.length) {
    throw new Error('Invalid GLB: JSON chunk exceeds buffer length');
  }
  const jsonBytes = buf.subarray(offset, offset + jsonChunkLength);
  offset += jsonChunkLength;
  const json = JSON.parse(jsonBytes.toString('utf8'));

  let bin = new Uint8Array(0);
  if (offset + CHUNK_HEADER_LENGTH <= buf.length) {
    const binChunkLength = buf.readUInt32LE(offset); offset += 4;
    const binChunkType = buf.readUInt32LE(offset); offset += 4;
    if (binChunkType !== CHUNK_TYPE_BIN) {
      throw new Error('Invalid GLB: second chunk is not BIN');
    }
    if (offset + binChunkLength > buf.length) {
      throw new Error('Invalid GLB: BIN chunk exceeds buffer length');
    }
    const binBytes = buf.subarray(offset, offset + binChunkLength);
    bin = new Uint8Array(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength);
  }

  return { json, bin };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function padChunk(buf, padByte) {
  const padLength = (4 - (buf.length % 4)) % 4;
  if (padLength === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(padLength, padByte)]);
}
