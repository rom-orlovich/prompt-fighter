import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  glbNodeNames,
  overlapRatio,
  payloadHeadroom,
  SKELETON_MATCH_FLOOR
} from '../scripts/probe-skeleton-compat.mjs';

/**
 * Makes the two hard gates on ANY candidate body mesh mechanically checkable
 * instead of a claim in prose: (1) does its skeleton share bone NAMES with the
 * vendored bodies — the property the shared Anims.glb clip library and every
 * hair mesh bind by — and (2) is there room for it under the shipped payload
 * budget. A Mixamo/Rigify-renamed rig scores 0 on gate 1 and silently animates
 * nothing; that is the failure this probe exists to catch before vendoring.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

function names(asset: string): string[] {
  const glb = readFileSync(join(ASSETS_DIR, `${asset}.glb`));
  return glbNodeNames(new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength));
}

describe('candidate-mesh skeleton compatibility probe', () => {
  it('reads real node/bone names out of a vendored GLB', () => {
    const male = names('Male');
    expect(male.length).toBeGreaterThan(50);
    expect(male.some((n) => n.length > 0)).toBe(true);
  });

  it('scores every already-vendored asset as compatible with the body skeleton', () => {
    const male = names('Male');
    for (const asset of [
      'Female',
      'Anims',
      'Hair_SimpleParted',
      'Hair_Beard',
      'Hair_Buzzed',
      'Hair_Long'
    ]) {
      expect(overlapRatio(names(asset), male), `${asset} overlap`).toBeGreaterThan(
        SKELETON_MATCH_FLOOR
      );
    }
  });

  it('rejects a Mixamo/Rigify-style renamed skeleton', () => {
    const male = names('Male');
    const mixamo = male.map((n) => `mixamorig:${n}`);
    expect(overlapRatio(mixamo, male)).toBe(0);
    expect(overlapRatio(mixamo, male)).toBeLessThan(SKELETON_MATCH_FLOOR);
  });

  it('scores a partial rename proportionally, not pass/fail only', () => {
    const reference = ['a', 'b', 'c', 'd'];
    expect(overlapRatio(['a', 'b', 'c', 'd'], reference)).toBe(1);
    expect(overlapRatio(['a', 'b', 'x', 'y'], reference)).toBe(0.5);
    expect(overlapRatio([], reference)).toBe(0);
  });

  it('reports how many bytes a new mesh could cost before the payload budget breaks', () => {
    const { usedBytes, maxBytes, headroomBytes } = payloadHeadroom(ASSETS_DIR);
    expect(usedBytes).toBeGreaterThan(5_000_000);
    expect(maxBytes).toBe(6 * 1024 * 1024);
    expect(headroomBytes).toBe(maxBytes - usedBytes);
    // The measured fact this probe exists to make checkable: there is NOT room
    // for another ~1.3MB body mesh under the shipped budget.
    expect(headroomBytes).toBeLessThan(1_300_000);
  });
});
