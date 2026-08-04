#!/usr/bin/env node
/**
 * Vendors the fighter bodies, hairstyles and animation clips into
 * `public/assets/characters/`.
 *
 * Three CC0 Quaternius sources, all sharing ONE Unreal-style skeleton, which is
 * the whole reason this combination works:
 *
 *   - Universal Base Characters — the bodies. Realistically proportioned
 *     (~7 heads), muscular, and shipped with ZERO animations.
 *   - Universal Animation Library — the clips, including a real boxing
 *     vocabulary (`Punch_Jab`, `Punch_Cross`, `Hit_Head`, `Hit_Chest`).
 *   - The base pack's hairstyles, rigged to the head bone.
 *
 * 66 of 67 bone names match between the bodies and the animation library, so the
 * clips drive the bodies directly and the hair rebinds onto the body skeleton by
 * name — no retargeting math, which is the step that usually turns a swap like
 * this into twisted limbs.
 *
 * NOTE the animation library must be the **Unreal-Godot** export
 * (`UAL1_Standard.glb`). The Godot-only mirror floating around GitHub uses
 * Blender/Rigify bone names (`DEF-head`, `DEF-f_index.03.L`) and shares exactly
 * ONE bone name with the bodies — its clips silently animate nothing.
 *
 * License: CC0 1.0 for all three packs (no attribution required).
 *   https://quaternius.itch.io/universal-base-characters
 *   https://quaternius.itch.io/universal-animation-library
 *
 * Both are name-your-own-price downloads behind itch.io's interactive flow, so
 * they are not fetched automatically. Download and unzip them, then point this
 * script at the two extracted folders:
 *
 *   node scripts/vendor-characters.mjs \
 *     --base "/path/to/Universal Base Characters[Standard]" \
 *     --anims "/path/to/Universal Animation Library[Standard]"
 *
 * Deterministic: unchanged inputs produce byte-identical output.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { packGltfToGlb, readGlb } from './gltf-to-glb.mjs';
import { trimGlb } from './trim-glb.mjs';
import { validateGlbStructure } from './validate-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

/** The two body meshes the free tier ships. */
export const BODIES = ['Male', 'Female'];

/** Hairstyles, one per fighter, so four fighters on two bodies still read apart. */
export const HAIRSTYLES = ['Hair_SimpleParted', 'Hair_Beard', 'Hair_Buzzed', 'Hair_Long'];

/**
 * The clips the game plays. Keep in sync with `POSE_CLIPS` in
 * `src/render/fighter.ts` and with `tests/vendored-assets.test.ts`.
 *
 * `Punch_Enter` is deliberately absent — it exists only in the Godot-named
 * export, which cannot drive these bodies. The guard-up stance is produced
 * instead by holding `Punch_Jab` at a fraction of its duration (see
 * `POSE_FREEZE` in fighter.ts).
 */
export const KEEP_CLIPS = [
  'Idle_Loop',
  'Sword_Idle',
  'Crouch_Idle_Loop',
  'Punch_Jab',
  'Punch_Cross',
  'Hit_Head',
  'Hit_Chest',
  'Death01',
  'Dance_Loop',
  'Walk_Loop'
];

const MAX_COMBINED_BYTES = 6 * 1024 * 1024;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

/** Packs a `.gltf` + `.bin` pair into one texture-free GLB and validates it. */
function packPair(dir, name, outName) {
  const gltf = JSON.parse(readFileSync(join(dir, `${name}.gltf`), 'utf8'));
  const bin = new Uint8Array(readFileSync(join(dir, `${name}.bin`)));
  const glb = packGltfToGlb(gltf, bin);
  const { valid, errors } = validateGlbStructure(glb);
  if (!valid) throw new Error(`${outName}: failed structural validation: ${errors.join('; ')}`);
  writeFileSync(join(OUT_DIR, outName), glb);
  return glb.byteLength;
}

function main() {
  const baseDir = arg('--base');
  const animsDir = arg('--anims');
  if (!baseDir || !animsDir) {
    throw new Error('need --base <Universal Base Characters[Standard]> and --anims <Universal Animation Library[Standard]>');
  }

  const bodySrc = join(baseDir, 'Base Characters', 'Godot - UE');
  const hairSrc = join(baseDir, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
  const animSrc = join(animsDir, 'Unreal-Godot', 'UAL1_Standard.glb');
  for (const p of [bodySrc, hairSrc, animSrc]) {
    if (!existsSync(p)) throw new Error(`missing expected pack path: ${p}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  let combined = 0;

  for (const body of BODIES) {
    const bytes = packPair(bodySrc, `Superhero_${body}_FullBody`, `${body}.glb`);
    combined += bytes;
    console.log(`${`${body}.glb`.padEnd(24)} ${(bytes / 1e6).toFixed(2)}MB`);
  }

  for (const hair of HAIRSTYLES) {
    const bytes = packPair(hairSrc, hair, `${hair}.glb`);
    combined += bytes;
    console.log(`${`${hair}.glb`.padEnd(24)} ${(bytes / 1e6).toFixed(2)}MB`);
  }

  // The animation library is already a GLB; it just carries 33 clips this game
  // never plays (driving, swimming, pistols, farming).
  const raw = new Uint8Array(readFileSync(animSrc));
  const trimmed = trimGlb(raw, KEEP_CLIPS);
  const { valid, errors } = validateGlbStructure(trimmed);
  if (!valid) throw new Error(`Anims.glb failed structural validation: ${errors.join('; ')}`);

  const clips = (readGlb(trimmed).json.animations ?? []).map((a) => a.name).sort();
  const expected = [...KEEP_CLIPS].sort();
  if (clips.join() !== expected.join()) {
    throw new Error(`Anims.glb kept the wrong clips: ${clips.join(', ')}`);
  }
  writeFileSync(join(OUT_DIR, 'Anims.glb'), trimmed);
  combined += trimmed.byteLength;
  console.log(
    `${'Anims.glb'.padEnd(24)} ${(raw.byteLength / 1e6).toFixed(2)}MB -> ` +
      `${(trimmed.byteLength / 1e6).toFixed(2)}MB  ${clips.length} clips`
  );

  console.log(`\ncombined: ${(combined / 1e6).toFixed(2)}MB (budget ${(MAX_COMBINED_BYTES / 1e6).toFixed(0)}MB)`);
  if (combined >= MAX_COMBINED_BYTES) throw new Error('combined vendored payload exceeds budget');
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
