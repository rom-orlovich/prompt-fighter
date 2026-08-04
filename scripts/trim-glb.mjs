// Drops every animation not named in keepAnimationNames from a source GLB, then
// drops every accessor/bufferView that was referenced only by a dropped animation,
// compacts + re-indexes what remains, repacks the BIN buffer, and rewrites every
// mesh-primitive/skin/animation-sampler reference to the new indices. Final
// image/texture stripping and GLB (re-)serialization is delegated to packGltfToGlb.

import { readGlb, packGltfToGlb } from './gltf-to-glb.mjs';

/**
 * @param {Uint8Array} sourceGlb
 * @param {string[]} keepAnimationNames
 * @returns {Uint8Array}
 */
export function trimGlb(sourceGlb, keepAnimationNames) {
  const { json, bin } = readGlb(sourceGlb);

  const sourceAnimations = json.animations ?? [];
  const keepSet = new Set(keepAnimationNames);
  for (const name of keepAnimationNames) {
    if (!sourceAnimations.some((anim) => anim.name === name)) {
      throw new Error(`trimGlb: requested animation "${name}" not found in source GLB`);
    }
  }

  const keptAnimations = sourceAnimations.filter((anim) => keepSet.has(anim.name));

  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];

  // 1. Collect every accessor index still referenced after dropping animations:
  //    mesh attributes/indices, skin inverse-bind-matrices, and kept animations'
  //    sampler input/output. Anything else was referenced only by a dropped
  //    animation (or nothing at all) and gets dropped.
  const keepAccessorIndices = new Set();
  const addAccessor = (idx) => {
    if (idx !== undefined && idx !== null) keepAccessorIndices.add(idx);
  };

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const accessorIdx of Object.values(primitive.attributes ?? {})) {
        addAccessor(accessorIdx);
      }
      addAccessor(primitive.indices);
    }
  }
  for (const skin of json.skins ?? []) {
    addAccessor(skin.inverseBindMatrices);
  }
  for (const animation of keptAnimations) {
    for (const sampler of animation.samplers ?? []) {
      addAccessor(sampler.input);
      addAccessor(sampler.output);
    }
  }

  const orderedAccessorIndices = accessors
    .map((_, idx) => idx)
    .filter((idx) => keepAccessorIndices.has(idx));

  // 2. Collect every bufferView still referenced by a kept accessor.
  const keepBufferViewIndices = new Set();
  for (const idx of orderedAccessorIndices) {
    const bv = accessors[idx].bufferView;
    if (bv !== undefined && bv !== null) keepBufferViewIndices.add(bv);
  }
  const orderedBufferViewIndices = bufferViews
    .map((_, idx) => idx)
    .filter((idx) => keepBufferViewIndices.has(idx));

  // 3. Repack the BIN buffer: copy each kept bufferView's bytes into a fresh
  //    buffer, 4-byte-aligned between entries, tracking old -> new indices.
  const bufferViewIndexMap = new Map();
  const newBufferViews = [];
  const dataChunks = [];
  let cursor = 0;
  for (const oldIdx of orderedBufferViewIndices) {
    const bv = bufferViews[oldIdx];
    const byteOffset = bv.byteOffset ?? 0;
    const byteLength = bv.byteLength;
    const data = bin.subarray(byteOffset, byteOffset + byteLength);
    const alignedOffset = alignTo4(cursor);
    dataChunks.push({ offset: alignedOffset, data });
    cursor = alignedOffset + byteLength;

    bufferViewIndexMap.set(oldIdx, newBufferViews.length);
    newBufferViews.push({ ...bv, buffer: 0, byteOffset: alignedOffset, byteLength });
  }
  const newBin = new Uint8Array(cursor);
  for (const chunk of dataChunks) {
    newBin.set(chunk.data, chunk.offset);
  }

  // 4. Compact + re-index the accessors, remapping each surviving bufferView ref.
  const accessorIndexMap = new Map();
  const newAccessors = [];
  for (const oldIdx of orderedAccessorIndices) {
    const accessor = accessors[oldIdx];
    const newAccessor = { ...accessor };
    if (accessor.bufferView !== undefined && accessor.bufferView !== null) {
      newAccessor.bufferView = bufferViewIndexMap.get(accessor.bufferView);
    }
    accessorIndexMap.set(oldIdx, newAccessors.length);
    newAccessors.push(newAccessor);
  }

  const remapAccessor = (idx) =>
    idx === undefined || idx === null ? idx : accessorIndexMap.get(idx);

  // 5. Rewrite every mesh-primitive / skin / animation-sampler reference to the
  //    new accessor indices.
  const newMeshes = (json.meshes ?? []).map((mesh) => ({
    ...mesh,
    primitives: (mesh.primitives ?? []).map((primitive) => {
      const newPrimitive = { ...primitive };
      if (primitive.attributes) {
        const newAttributes = {};
        for (const [name, accessorIdx] of Object.entries(primitive.attributes)) {
          newAttributes[name] = remapAccessor(accessorIdx);
        }
        newPrimitive.attributes = newAttributes;
      }
      if (primitive.indices !== undefined) {
        newPrimitive.indices = remapAccessor(primitive.indices);
      }
      return newPrimitive;
    })
  }));

  const newSkins = (json.skins ?? []).map((skin) => ({
    ...skin,
    ...(skin.inverseBindMatrices !== undefined
      ? { inverseBindMatrices: remapAccessor(skin.inverseBindMatrices) }
      : {})
  }));

  const newAnimations = keptAnimations.map((animation) => ({
    ...animation,
    samplers: (animation.samplers ?? []).map((sampler) => ({
      ...sampler,
      input: remapAccessor(sampler.input),
      output: remapAccessor(sampler.output)
    }))
  }));

  const trimmedDoc = {
    ...json,
    meshes: newMeshes,
    skins: newSkins,
    animations: newAnimations,
    accessors: newAccessors,
    bufferViews: newBufferViews
  };

  return packGltfToGlb(trimmedDoc, newBin);
}

function alignTo4(offset) {
  return (offset + 3) & ~3;
}
