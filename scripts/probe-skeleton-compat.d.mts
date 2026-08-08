export const SKELETON_MATCH_FLOOR: number;
export function glbNodeNames(bytes: Uint8Array): string[];
export function overlapRatio(candidateNames: string[], referenceNames: string[]): number;
export function payloadHeadroom(
  dir: string,
  maxBytes?: number
): { usedBytes: number; maxBytes: number; headroomBytes: number };
