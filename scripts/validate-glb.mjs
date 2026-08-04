// Genuine structural validator for a binary GLB buffer.
//
// Unlike a "does it parse" check, this walks every cross-reference a glTF-2.0
// document makes (mesh/skin/animation accessor -> bufferView -> BIN chunk byte
// range) and confirms each one actually resolves and fits, plus every animation
// channel's sampler/target-node and every skin joint node.

import { readGlb } from './gltf-to-glb.mjs';

const COMPONENT_TYPE_SIZES = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4 // FLOAT
};

const TYPE_COMPONENT_COUNTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

/**
 * @param {Uint8Array} glb
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateGlbStructure(glb) {
  const errors = [];

  let json;
  let bin;
  try {
    ({ json, bin } = readGlb(glb));
  } catch (err) {
    return { valid: false, errors: [`Failed to parse GLB: ${err.message}`] };
  }

  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const nodes = json.nodes ?? [];

  function checkAccessorFootprint(accessorIndex, context) {
    if (accessorIndex === undefined || accessorIndex === null) return;
    const accessor = accessors[accessorIndex];
    if (!accessor) {
      errors.push(`${context}: accessor ${accessorIndex} does not exist`);
      return;
    }
    const bvIndex = accessor.bufferView;
    if (bvIndex === undefined || bvIndex === null) {
      // Zero-filled accessor (no bufferView) — valid per spec, nothing to check.
      return;
    }
    const bufferView = bufferViews[bvIndex];
    if (!bufferView) {
      errors.push(`${context}: accessor ${accessorIndex} references bufferView ${bvIndex} which does not exist`);
      return;
    }
    const bvByteOffset = bufferView.byteOffset ?? 0;
    const bvEnd = bvByteOffset + bufferView.byteLength;
    if (bvEnd > bin.length) {
      errors.push(
        `${context}: accessor ${accessorIndex}'s bufferView ${bvIndex} (offset ${bvByteOffset}, length ${bufferView.byteLength}) exceeds BIN chunk length ${bin.length}`
      );
      return;
    }

    const componentSize = COMPONENT_TYPE_SIZES[accessor.componentType];
    const componentCount = TYPE_COMPONENT_COUNTS[accessor.type];
    if (!componentSize || !componentCount) {
      errors.push(
        `${context}: accessor ${accessorIndex} has unknown componentType ${accessor.componentType} or type ${accessor.type}`
      );
      return;
    }
    const elementSize = componentSize * componentCount;
    const accessorByteOffset = accessor.byteOffset ?? 0;
    const stride = bufferView.byteStride ?? elementSize;
    const footprintEnd = accessorByteOffset + stride * Math.max(0, accessor.count - 1) + elementSize;
    if (footprintEnd > bufferView.byteLength) {
      errors.push(
        `${context}: accessor ${accessorIndex}'s data (offset ${accessorByteOffset}, footprint ${footprintEnd}) exceeds its bufferView ${bvIndex} length ${bufferView.byteLength}`
      );
    }
  }

  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const [primIndex, primitive] of (mesh.primitives ?? []).entries()) {
      for (const [attrName, accessorIndex] of Object.entries(primitive.attributes ?? {})) {
        checkAccessorFootprint(accessorIndex, `mesh ${meshIndex} primitive ${primIndex} attribute ${attrName}`);
      }
      if (primitive.indices !== undefined) {
        checkAccessorFootprint(primitive.indices, `mesh ${meshIndex} primitive ${primIndex} indices`);
      }
    }
  }

  for (const [skinIndex, skin] of (json.skins ?? []).entries()) {
    if (skin.inverseBindMatrices !== undefined) {
      checkAccessorFootprint(skin.inverseBindMatrices, `skin ${skinIndex} inverseBindMatrices`);
    }
    for (const jointIndex of skin.joints ?? []) {
      if (!nodes[jointIndex]) {
        errors.push(`skin ${skinIndex}: joint node ${jointIndex} does not exist`);
      }
    }
  }

  for (const [animIndex, animation] of (json.animations ?? []).entries()) {
    const samplers = animation.samplers ?? [];
    for (const [samplerIndex, sampler] of samplers.entries()) {
      checkAccessorFootprint(sampler.input, `animation ${animIndex} sampler ${samplerIndex} input`);
      checkAccessorFootprint(sampler.output, `animation ${animIndex} sampler ${samplerIndex} output`);
    }
    for (const [channelIndex, channel] of (animation.channels ?? []).entries()) {
      if (channel.sampler === undefined || !samplers[channel.sampler]) {
        errors.push(`animation ${animIndex} channel ${channelIndex}: sampler ${channel.sampler} does not exist`);
      }
      const targetNode = channel.target?.node;
      if (targetNode !== undefined && !nodes[targetNode]) {
        errors.push(`animation ${animIndex} channel ${channelIndex}: target node ${targetNode} does not exist`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
