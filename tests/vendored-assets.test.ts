import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateGlbStructure } from '../scripts/validate-glb.mjs';
import { readGlb } from '../scripts/gltf-to-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');
const RIG = 'Fighter';
const MAX_BYTES = 5 * 1024 * 1024;

/** Must stay in sync with `KEEP_CLIPS` in scripts/vendor-characters.mjs. */
const EXPECTED_CLIPS = [
  'Punch_Enter',
  'Punch_Jab',
  'Punch_Cross',
  'Crouch_Idle_Loop',
  'Hit_Head',
  'Hit_Chest',
  'Death01',
  'Dance_Loop',
  'Idle_Loop',
  'Walk_Loop'
].sort();

/** Every clip `POSE_CLIPS` in src/render/fighter.ts can ask the mixer for. */
const POSE_CLIPS = [
  'Punch_Enter',
  'Crouch_Idle_Loop',
  'Punch_Jab',
  'Punch_Cross',
  'Hit_Head',
  'Hit_Chest',
  'Death01',
  'Dance_Loop'
];

function loadRig() {
  const glb = readFileSync(join(ASSETS_DIR, `${RIG}.glb`));
  return new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength);
}

describe('vendored fighter rig', () => {
  it('ships the shared fighter rig', () => {
    expect(() => statSync(join(ASSETS_DIR, `${RIG}.glb`)), `${RIG}.glb should exist`).not.toThrow();
  });

  it('is structurally valid', () => {
    // Deliberately not a size assertion: a trimmed GLB that still carries
    // dangling accessor -> bufferView references has a perfectly plausible
    // size and still fails to load.
    const { valid, errors } = validateGlbStructure(loadRig());
    expect(errors, `${RIG}.glb structural errors`).toEqual([]);
    expect(valid).toBe(true);
  });

  it('stays inside the payload budget', () => {
    const size = statSync(join(ASSETS_DIR, `${RIG}.glb`)).size;
    expect(size, `bytes: ${size}`).toBeLessThan(MAX_BYTES);
    expect(size, 'a truncated rig would be suspiciously small').toBeGreaterThan(100_000);
  });

  it('keeps exactly the vendored clip set', () => {
    const names = (readGlb(loadRig()).json.animations ?? [])
      .map((a: { name: string }) => a.name)
      .sort();
    expect(names).toEqual(EXPECTED_CLIPS);
  });

  it('carries every clip the pose map can ask for', () => {
    // Guards the failure mode where a pose silently falls through to "keep
    // whatever is playing" because its clip was trimmed away.
    const names = new Set(
      (readGlb(loadRig()).json.animations ?? []).map((a: { name: string }) => a.name)
    );
    for (const clip of POSE_CLIPS) {
      expect(names.has(clip), `pose map needs ${clip}`).toBe(true);
    }
  });
});
