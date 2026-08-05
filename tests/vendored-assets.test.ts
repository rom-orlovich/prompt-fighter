import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateGlbStructure } from '../scripts/validate-glb.mjs';
import { readGlb } from '../scripts/gltf-to-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

const BODIES = ['Male', 'Female'];
const HAIRSTYLES = ['Hair_SimpleParted', 'Hair_Beard', 'Hair_Buzzed', 'Hair_Long'];
const ANIMS = 'Anims';
const ALL = [...BODIES, ...HAIRSTYLES, ANIMS];

const MAX_COMBINED_BYTES = 6 * 1024 * 1024;

/** Must stay in sync with `KEEP_CLIPS` + `KEEP_CLIPS_2` in scripts/vendor-characters.mjs. */
const EXPECTED_CLIPS = [
  'Idle_Loop',
  'Sword_Idle',
  'Crouch_Idle_Loop',
  'Punch_Jab',
  'Punch_Cross',
  'Hit_Head',
  'Hit_Chest',
  'Death01',
  'Dance_Loop',
  'Walk_Loop',
  // G17, vendored from Universal Animation Library 2 — see KEEP_CLIPS_2.
  'Melee_Hook',
  'Hit_Knockback',
  'Idle_Shield_Loop',
  'Slide_Start',
  // G20a, vendored from UAL1 — see KEEP_CLIPS in scripts/vendor-characters.mjs.
  'Jump_Start'
].sort();

/** Every clip `POSE_CLIPS` in src/render/fighter.ts can ask the mixer for. */
const POSE_CLIPS = [
  'Sword_Idle',
  'Punch_Jab',
  'Punch_Cross',
  'Crouch_Idle_Loop',
  'Hit_Head',
  'Hit_Chest',
  'Death01',
  'Dance_Loop',
  // G17
  'Melee_Hook',
  'Hit_Knockback',
  'Idle_Shield_Loop',
  'Slide_Start',
  // G20a
  'Jump_Start'
];

function load(asset: string) {
  const glb = readFileSync(join(ASSETS_DIR, `${asset}.glb`));
  return new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength);
}

function json(asset: string) {
  return readGlb(load(asset)).json;
}

describe('vendored character assets', () => {
  it('ships every body, hairstyle and the shared clip library', () => {
    for (const asset of ALL) {
      expect(() => statSync(join(ASSETS_DIR, `${asset}.glb`)), `${asset}.glb should exist`).not.toThrow();
    }
  });

  it('is structurally valid for every vendored asset', () => {
    // Deliberately not a size assertion: a packed/trimmed GLB that still carries
    // dangling accessor -> bufferView references has a perfectly plausible size
    // and still fails to load.
    for (const asset of ALL) {
      const { valid, errors } = validateGlbStructure(load(asset));
      expect(errors, `${asset}.glb structural errors`).toEqual([]);
      expect(valid, asset).toBe(true);
    }
  });

  it('keeps the combined payload inside budget', () => {
    const total = ALL.reduce((sum, a) => sum + statSync(join(ASSETS_DIR, `${a}.glb`)).size, 0);
    expect(total, `combined bytes: ${total}`).toBeLessThan(MAX_COMBINED_BYTES);
  });

  it('keeps exactly the vendored clip set', () => {
    const names = (json(ANIMS).animations ?? []).map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(EXPECTED_CLIPS);
  });

  it('carries every clip the pose map can ask for', () => {
    // Guards the failure mode where a pose silently falls through to "keep
    // whatever is playing" because its clip was trimmed away.
    const names = new Set((json(ANIMS).animations ?? []).map((a: { name: string }) => a.name));
    for (const clip of POSE_CLIPS) {
      expect(names.has(clip), `pose map needs ${clip}`).toBe(true);
    }
  });

  it('gives the bodies a skinned mesh and a skeleton to animate', () => {
    for (const body of BODIES) {
      const j = json(body);
      expect((j.meshes ?? []).length, `${body} meshes`).toBeGreaterThan(0);
      expect((j.skins ?? []).length, `${body} skins`).toBe(1);
      // The bodies ship with no clips of their own — that is why Anims.glb exists.
      expect((j.animations ?? []).length, `${body} animations`).toBe(0);
    }
  });

  it('shares one skeleton across bodies, hair and clips', () => {
    // This is the property the whole approach rests on: the clips and the hair
    // bind to the body by BONE NAME. The Godot-named export of the same library
    // shares exactly ONE bone name with these bodies and silently animates
    // nothing, so a name-overlap check is the guard against re-vendoring it.
    const bodyBones = new Set((json('Male').nodes ?? []).map((n: { name?: string }) => n.name ?? ''));

    const animBones = (json(ANIMS).nodes ?? []).map((n: { name?: string }) => n.name ?? '');
    const animShared = animBones.filter((n: string) => bodyBones.has(n));
    expect(
      animShared.length / animBones.length,
      `clip library shares ${animShared.length}/${animBones.length} bone names with the body`
    ).toBeGreaterThan(0.9);

    for (const hair of HAIRSTYLES) {
      const hairBones = (json(hair).nodes ?? []).map((n: { name?: string }) => n.name ?? '');
      const shared = hairBones.filter((n: string) => bodyBones.has(n));
      expect(
        shared.length / hairBones.length,
        `${hair} shares ${shared.length}/${hairBones.length} bone names with the body`
      ).toBeGreaterThan(0.9);
    }
  });
});
