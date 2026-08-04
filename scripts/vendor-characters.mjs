#!/usr/bin/env node
/**
 * Vendors the four KayKit "Adventurers" fighter models into `public/assets/characters/`.
 *
 * The upstream pack ships each character as a ~3.6MB GLB carrying all 76 of its
 * animations. The game only ever plays the seven clips `src/render/fighter.ts`
 * maps its poses onto, so each model is trimmed down to those before it lands in
 * the repo — about 0.6MB apiece, ~2.5MB for the whole roster.
 *
 * Source:  https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
 * License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) — free for
 *          personal, educational and commercial use, no attribution required.
 *
 * Usage:
 *   node scripts/vendor-characters.mjs              # download, trim, write
 *   node scripts/vendor-characters.mjs --cache DIR  # reuse already-downloaded raw GLBs
 *
 * Re-running is idempotent: the trimmer is deterministic, so unchanged inputs
 * produce byte-identical outputs and leave the working tree clean.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { trimGlb } from './trim-glb.mjs';
import { validateGlbStructure } from './validate-glb.mjs';
import { readGlb } from './gltf-to-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

const BASE_URL =
  'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main' +
  '/addons/kaykit_character_pack_adventures/Characters/gltf';

/** The roster's four models. Which fighter wears which lives in `src/roster/characters.ts`. */
export const MODELS = ['Barbarian', 'Knight', 'Mage', 'Rogue'];

/**
 * The only clips the game plays — one per `PoseName` in `src/render/fighter.ts`.
 * Keep in sync with that file's POSE_CLIPS map and with tests/vendored-assets.test.ts.
 */
export const KEEP_CLIPS = [
  'Idle',
  'Blocking',
  'Unarmed_Melee_Attack_Punch_A',
  'Block',
  'Hit_A',
  'Death_A',
  'Cheer'
];

/** Fail the vendor step rather than commit a roster that would blow the bundle budget. */
const MAX_COMBINED_BYTES = 5 * 1024 * 1024;

async function fetchModel(name, cacheDir) {
  if (cacheDir) {
    const cached = join(cacheDir, `${name}.glb`);
    if (existsSync(cached)) {
      const buf = readFileSync(cached);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  }
  const res = await fetch(`${BASE_URL}/${name}.glb`);
  if (!res.ok) throw new Error(`${name}.glb: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const cacheIdx = process.argv.indexOf('--cache');
  const cacheDir = cacheIdx === -1 ? null : process.argv[cacheIdx + 1];

  mkdirSync(OUT_DIR, { recursive: true });

  let combined = 0;
  for (const name of MODELS) {
    const raw = await fetchModel(name, cacheDir);
    const trimmed = trimGlb(raw, KEEP_CLIPS);

    // A trimmed GLB that merely has the right *size* can still carry dangling
    // accessor -> bufferView references, so check the structure before writing.
    const { valid, errors } = validateGlbStructure(trimmed);
    if (!valid) throw new Error(`${name}.glb failed structural validation: ${errors.join('; ')}`);

    const clips = (readGlb(trimmed).json.animations ?? []).map((a) => a.name).sort();
    const expected = [...KEEP_CLIPS].sort();
    if (clips.join() !== expected.join()) {
      throw new Error(`${name}.glb kept the wrong clips: ${clips.join(', ')}`);
    }

    writeFileSync(join(OUT_DIR, `${name}.glb`), trimmed);
    combined += trimmed.byteLength;
    const pct = ((1 - trimmed.byteLength / raw.byteLength) * 100).toFixed(1);
    console.log(
      `${name.padEnd(10)} ${(raw.byteLength / 1e6).toFixed(2)}MB -> ` +
        `${(trimmed.byteLength / 1e6).toFixed(2)}MB (-${pct}%)  ${clips.length} clips`
    );
  }

  console.log(`\ncombined: ${(combined / 1e6).toFixed(2)}MB (budget ${(MAX_COMBINED_BYTES / 1e6).toFixed(0)}MB)`);
  if (combined >= MAX_COMBINED_BYTES) throw new Error('combined vendored payload exceeds the 5MB budget');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
