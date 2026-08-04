export function packGltfToGlb(
  gltf: Record<string, unknown>,
  bin: Uint8Array,
  opts?: {
    keepTextureSlots?: Set<string>;
    resolveImageBytes?: (image: Record<string, unknown>, imageIndex: number) => Uint8Array | undefined;
  }
): Uint8Array;
export function readGlb(glb: Uint8Array): { json: any; bin: Uint8Array };
