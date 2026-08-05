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

/**
 * Merges kept animations from MULTIPLE animation-library GLBs into one glTF
 * document — G17's route into the vendored library, since the free tier of
 * any single Quaternius animation pack doesn't cover an unarmed fistfight's
 * full vocabulary (Universal Animation Library has the jab/cross/hurt/idle
 * set; Universal Animation Library 2 is where `Melee_Hook`, `Hit_Knockback`,
 * `Idle_Shield_Loop` and `Slide_Start` live).
 *
 * This only works because `sources[0]` and every later source export the
 * IDENTICAL node hierarchy — same length, same names, same order (verified:
 * UAL1's and UAL2's `Unreal-Godot` exports both emit 67 nodes in lockstep).
 * That means an animation channel's `target.node` index means the same bone
 * in every source, so nodes/mesh/skin are taken untouched from `sources[0]`
 * (same as `trimGlb`) and never need remapping — only each source's own
 * accessor/bufferView graph (real per-file binary data) is compacted and
 * appended into one combined BIN buffer, with each source's kept animation
 * samplers rewritten to point at their new, merged accessor indices.
 *
 * @param {{ glb: Uint8Array, keep: string[] }[]} sources
 * @returns {Uint8Array}
 */
export function mergeAnimGlbs(sources) {
  if (sources.length === 0) throw new Error('mergeAnimGlbs: need at least one source');

  const parsed = sources.map(({ glb, keep }) => ({ ...readGlb(glb), keep }));

  const baseNodeNames = (parsed[0].json.nodes ?? []).map((n) => n.name ?? '');
  for (let i = 1; i < parsed.length; i += 1) {
    const names = (parsed[i].json.nodes ?? []).map((n) => n.name ?? '');
    const matches = names.length === baseNodeNames.length && names.every((n, idx) => n === baseNodeNames[idx]);
    if (!matches) {
      throw new Error(
        `mergeAnimGlbs: source ${i}'s node order/names differ from source 0 — channel target.node ` +
          'indices would silently point at the wrong bone if merged'
      );
    }
  }

  // --- source 0: keep its mesh/skin geometry AND its own requested clips,
  // exactly like trimGlb's single-source algorithm. ------------------------
  const base = parsed[0];
  const baseAccessors = base.json.accessors ?? [];
  const baseBufferViews = base.json.bufferViews ?? [];
  const baseAnimations = base.json.animations ?? [];
  const baseKeepSet = new Set(base.keep);
  for (const name of base.keep) {
    if (!baseAnimations.some((anim) => anim.name === name)) {
      throw new Error(`mergeAnimGlbs: requested animation "${name}" not found in source 0`);
    }
  }
  const baseKeptAnimations = baseAnimations.filter((anim) => baseKeepSet.has(anim.name));

  const keepAccessorIndices = new Set();
  const addAccessor = (idx) => {
    if (idx !== undefined && idx !== null) keepAccessorIndices.add(idx);
  };
  for (const mesh of base.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const accessorIdx of Object.values(primitive.attributes ?? {})) addAccessor(accessorIdx);
      addAccessor(primitive.indices);
    }
  }
  for (const skin of base.json.skins ?? []) addAccessor(skin.inverseBindMatrices);
  for (const animation of baseKeptAnimations) {
    for (const sampler of animation.samplers ?? []) {
      addAccessor(sampler.input);
      addAccessor(sampler.output);
    }
  }

  const orderedAccessorIndices = baseAccessors
    .map((_, idx) => idx)
    .filter((idx) => keepAccessorIndices.has(idx));
  const keepBufferViewIndices = new Set();
  for (const idx of orderedAccessorIndices) {
    const bv = baseAccessors[idx].bufferView;
    if (bv !== undefined && bv !== null) keepBufferViewIndices.add(bv);
  }
  const orderedBufferViewIndices = baseBufferViews
    .map((_, idx) => idx)
    .filter((idx) => keepBufferViewIndices.has(idx));

  const bufferViewIndexMap = new Map();
  const newBufferViews = [];
  const dataChunks = [];
  let cursor = 0;
  for (const oldIdx of orderedBufferViewIndices) {
    const bv = baseBufferViews[oldIdx];
    const byteOffset = bv.byteOffset ?? 0;
    const byteLength = bv.byteLength;
    const data = base.bin.subarray(byteOffset, byteOffset + byteLength);
    const alignedOffset = alignTo4(cursor);
    dataChunks.push({ offset: alignedOffset, data });
    cursor = alignedOffset + byteLength;
    bufferViewIndexMap.set(oldIdx, newBufferViews.length);
    newBufferViews.push({ ...bv, buffer: 0, byteOffset: alignedOffset, byteLength });
  }

  const accessorIndexMap = new Map();
  const newAccessors = [];
  for (const oldIdx of orderedAccessorIndices) {
    const accessor = baseAccessors[oldIdx];
    const newAccessor = { ...accessor };
    if (accessor.bufferView !== undefined && accessor.bufferView !== null) {
      newAccessor.bufferView = bufferViewIndexMap.get(accessor.bufferView);
    }
    accessorIndexMap.set(oldIdx, newAccessors.length);
    newAccessors.push(newAccessor);
  }
  const remapBaseAccessor = (idx) => (idx === undefined || idx === null ? idx : accessorIndexMap.get(idx));

  const newMeshes = (base.json.meshes ?? []).map((mesh) => ({
    ...mesh,
    primitives: (mesh.primitives ?? []).map((primitive) => {
      const newPrimitive = { ...primitive };
      if (primitive.attributes) {
        const newAttributes = {};
        for (const [name, accessorIdx] of Object.entries(primitive.attributes)) {
          newAttributes[name] = remapBaseAccessor(accessorIdx);
        }
        newPrimitive.attributes = newAttributes;
      }
      if (primitive.indices !== undefined) newPrimitive.indices = remapBaseAccessor(primitive.indices);
      return newPrimitive;
    })
  }));
  const newSkins = (base.json.skins ?? []).map((skin) => ({
    ...skin,
    ...(skin.inverseBindMatrices !== undefined
      ? { inverseBindMatrices: remapBaseAccessor(skin.inverseBindMatrices) }
      : {})
  }));
  const mergedAnimations = baseKeptAnimations.map((animation) => ({
    ...animation,
    samplers: (animation.samplers ?? []).map((sampler) => ({
      ...sampler,
      input: remapBaseAccessor(sampler.input),
      output: remapBaseAccessor(sampler.output)
    }))
  }));

  // --- every later source: append ONLY its kept animations' sampler data,
  // re-indexed to continue where source 0's compacted arrays left off. -----
  for (let i = 1; i < parsed.length; i += 1) {
    const src = parsed[i];
    const srcAnimations = src.json.animations ?? [];
    const srcKeepSet = new Set(src.keep);
    for (const name of src.keep) {
      if (!srcAnimations.some((anim) => anim.name === name)) {
        throw new Error(`mergeAnimGlbs: requested animation "${name}" not found in source ${i}`);
      }
    }
    const srcKeptAnimations = srcAnimations.filter((anim) => srcKeepSet.has(anim.name));

    const srcKeepAccessorIndices = new Set();
    for (const animation of srcKeptAnimations) {
      for (const sampler of animation.samplers ?? []) {
        if (sampler.input !== undefined && sampler.input !== null) srcKeepAccessorIndices.add(sampler.input);
        if (sampler.output !== undefined && sampler.output !== null) srcKeepAccessorIndices.add(sampler.output);
      }
    }
    const srcAccessors = src.json.accessors ?? [];
    const srcBufferViews = src.json.bufferViews ?? [];
    const srcOrderedAccessorIndices = srcAccessors
      .map((_, idx) => idx)
      .filter((idx) => srcKeepAccessorIndices.has(idx));
    const srcKeepBufferViewIndices = new Set();
    for (const idx of srcOrderedAccessorIndices) {
      const bv = srcAccessors[idx].bufferView;
      if (bv !== undefined && bv !== null) srcKeepBufferViewIndices.add(bv);
    }
    const srcOrderedBufferViewIndices = srcBufferViews
      .map((_, idx) => idx)
      .filter((idx) => srcKeepBufferViewIndices.has(idx));

    const srcBufferViewIndexMap = new Map();
    for (const oldIdx of srcOrderedBufferViewIndices) {
      const bv = srcBufferViews[oldIdx];
      const byteOffset = bv.byteOffset ?? 0;
      const byteLength = bv.byteLength;
      const data = src.bin.subarray(byteOffset, byteOffset + byteLength);
      const alignedOffset = alignTo4(cursor);
      dataChunks.push({ offset: alignedOffset, data });
      cursor = alignedOffset + byteLength;
      srcBufferViewIndexMap.set(oldIdx, newBufferViews.length);
      newBufferViews.push({ ...bv, buffer: 0, byteOffset: alignedOffset, byteLength });
    }
    const srcAccessorIndexMap = new Map();
    for (const oldIdx of srcOrderedAccessorIndices) {
      const accessor = srcAccessors[oldIdx];
      const newAccessor = { ...accessor };
      if (accessor.bufferView !== undefined && accessor.bufferView !== null) {
        newAccessor.bufferView = srcBufferViewIndexMap.get(accessor.bufferView);
      }
      srcAccessorIndexMap.set(oldIdx, newAccessors.length);
      newAccessors.push(newAccessor);
    }
    const remapSrcAccessor = (idx) => (idx === undefined || idx === null ? idx : srcAccessorIndexMap.get(idx));
    for (const animation of srcKeptAnimations) {
      mergedAnimations.push({
        ...animation,
        samplers: (animation.samplers ?? []).map((sampler) => ({
          ...sampler,
          input: remapSrcAccessor(sampler.input),
          output: remapSrcAccessor(sampler.output)
        }))
      });
    }
  }

  const newBin = new Uint8Array(cursor);
  for (const chunk of dataChunks) newBin.set(chunk.data, chunk.offset);

  const mergedDoc = {
    ...base.json,
    meshes: newMeshes,
    skins: newSkins,
    animations: mergedAnimations,
    accessors: newAccessors,
    bufferViews: newBufferViews
  };

  return packGltfToGlb(mergedDoc, newBin);
}
