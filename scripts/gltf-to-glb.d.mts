export function packGltfToGlb(gltf: Record<string, unknown>, bin: Uint8Array): Uint8Array;
export function readGlb(glb: Uint8Array): { json: any; bin: Uint8Array };
