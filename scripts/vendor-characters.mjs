#!/usr/bin/env node
/**
 * Vendors the fighter rig into `public/assets/characters/`.
 *
 * The roster used to ship four KayKit "Adventurers" models. They were CC0 and
 * cleanly rigged, but they are chibi fantasy characters — roughly three heads
 * tall, in wizard hats and knight helmets — which is the opposite of the
 * grounded fistfighter look this game is going for.
 *
 * Quaternius's Universal Animation Library ships a realistically-proportioned
 * humanoid (~7 heads) together with 46 clips on that same skeleton, including a
 * real boxing vocabulary: `Punch_Enter` (raise guard), `Punch_Jab`,
 * `Punch_Cross`, `Hit_Head`, `Hit_Chest`, `Death01`. Mesh and clips living in
 * one file means no cross-file skeleton retargeting, which is the usual way this
 * kind of swap goes wrong.
 *
 * Source:  https://github.com/J-Ponzo/gltf-universal-animation-library
 *          (mirror of https://quaternius.itch.io/universal-animation-library)
 * License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) — free
 *          for personal, educational and commercial use, no attribution required.
 *
 * Usage:
 *   node scripts/vendor-characters.mjs              # download, pack, trim, write
 *   node scripts/vendor-characters.mjs --cache DIR  # reuse a downloaded .gltf/.bin
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

const BASE_URL =
  'https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/main/glTF';
const SOURCE_GLTF = 'AnimationLibrary_Godot_Standard.gltf';
const SOURCE_BIN = 'AnimationLibrary_Godot_Standard.bin';

/** Every fighter wears the same rig; they differ by tint, height and build. */
export const MODEL_ID = 'Fighter';

/**
 * The clips the game plays, plus `Walk_Loop` as a spare for future footwork.
 * Keep in sync with `POSE_CLIPS` in `src/render/fighter.ts` and with
 * `tests/vendored-assets.test.ts`.
 */
export const KEEP_CLIPS = [
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
];

const MAX_BYTES = 5 * 1024 * 1024;

async function fetchFile(name, cacheDir) {
  if (cacheDir) {
    const cached = join(cacheDir, name);
    if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
  }
  const res = await fetch(`${BASE_URL}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const cacheIdx = process.argv.indexOf('--cache');
  const cacheDir = cacheIdx === -1 ? null : process.argv[cacheIdx + 1];

  mkdirSync(OUT_DIR, { recursive: true });

  const gltfBytes = await fetchFile(SOURCE_GLTF, cacheDir);
  const binBytes = await fetchFile(SOURCE_BIN, cacheDir);
  const gltf = JSON.parse(Buffer.from(gltfBytes).toString('utf8'));

  // Pack .gltf + .bin into one GLB, dropping textures — every material in this
  // game is a flat brand-hue tint, so the pack's atlas would be dead weight.
  const packed = packGltfToGlb(gltf, binBytes);

  // Then drop the ~36 clips this game never plays (driving, swimming, pistols...).
  const trimmed = trimGlb(packed, KEEP_CLIPS);

  const { valid, errors } = validateGlbStructure(trimmed);
  if (!valid) throw new Error(`fighter rig failed structural validation: ${errors.join('; ')}`);

  const clips = (readGlb(trimmed).json.animations ?? []).map((a) => a.name).sort();
  const expected = [...KEEP_CLIPS].sort();
  if (clips.join() !== expected.join()) {
    throw new Error(`fighter rig kept the wrong clips: ${clips.join(', ')}`);
  }

  writeFileSync(join(OUT_DIR, `${MODEL_ID}.glb`), trimmed);

  const pct = ((1 - trimmed.byteLength / packed.byteLength) * 100).toFixed(1);
  console.log(
    `${MODEL_ID}.glb  source ${(packed.byteLength / 1e6).toFixed(2)}MB -> ` +
      `${(trimmed.byteLength / 1e6).toFixed(2)}MB (-${pct}%)  ${clips.length} clips`
  );
  if (trimmed.byteLength >= MAX_BYTES) throw new Error('vendored payload exceeds the 5MB budget');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
