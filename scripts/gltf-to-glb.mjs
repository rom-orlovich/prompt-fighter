// Zero-dependency glTF (.gltf + .bin) -> glTF-2.0 GLB packer.
//
// Strips every image/texture/sampler reference (this project only ever uses flat,
// untextured PBR materials), drops secondary UV sets (TEXCOORD_1..n) and vertex-colour
// attributes (COLOR_n) that would otherwise tint a flat material, inlines the .bin
// payload as the document's single unnamed buffer, and emits a 4-byte-aligned binary
// glTF container per the glTF-2.0 GLB spec:
// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format-specification

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const GLB_HEADER_LENGTH = 12;
const CHUNK_HEADER_LENGTH = 8;

/**
 * @param {Record<string, unknown>} gltf
 * @param {Uint8Array} bin
 * @returns {Uint8Array}
 */
export function packGltfToGlb(gltf, bin) {
  const doc = deepClone(gltf);

  // Drop every image/texture/sampler — this pipeline ships flat, untextured materials.
  delete doc.images;
  delete doc.textures;
  delete doc.samplers;

  for (const material of doc.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    const pbr = (material.pbrMetallicRoughness ??= {});
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    pbr.baseColorFactor ??= [1, 1, 1, 1];
  }

  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const attributeName of Object.keys(primitive.attributes ?? {})) {
        if (/^(TEXCOORD_[1-9]\d*|COLOR_\d+)$/.test(attributeName)) {
          delete primitive.attributes[attributeName];
        }
      }
    }
  }

  // Inline the .bin payload as the single unnamed (GLB-embedded) buffer.
  doc.buffers = [{ byteLength: bin.length }];

  const jsonChunk = padChunk(Buffer.from(JSON.stringify(doc), 'utf8'), 0x20);
  const binChunk = padChunk(Buffer.from(bin), 0x00);

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

function padChunk(buf, padByte) {
  const padLength = (4 - (buf.length % 4)) % 4;
  if (padLength === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(padLength, padByte)]);
}
