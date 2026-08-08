#!/usr/bin/env node
// Mesh-acquisition compatibility probe.
//
// Answers exactly two mechanical questions about a candidate body/hair GLB before
// it is ever vendored into public/assets/characters/:
//
//   1. Does its skeleton share bone NAMES with the already-vendored bodies? The
//      shared Anims.glb clip library and every hair mesh bind to the body by bone
//      NAME (see tests/vendored-assets.test.ts "shares one skeleton across
//      bodies, hair and clips") — a re-rigged/renamed skeleton (Mixamo's
//      `mixamorig:*` prefix, a Rigify export, etc.) silently animates nothing even
//      though the GLB loads and validates fine structurally.
//   2. Is there room for it under the shipped 6 MB combined-payload budget
//      (tests/vendored-assets.test.ts "keeps the combined payload inside
//      budget")?
//
// Zero dependencies beyond ./gltf-to-glb.mjs's readGlb, so this can run standalone
// against any candidate .glb without vendoring it first.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readGlb } from './gltf-to-glb.mjs';

/** Minimum bone-name overlap ratio a candidate must clear to be considered
 *  skeleton-compatible with the vendored bodies. Matches the floor already
 *  enforced by tests/vendored-assets.test.ts's "shares one skeleton..." check. */
export const SKELETON_MATCH_FLOOR = 0.9;

/**
 * Reads every `nodes[].name` out of a GLB's embedded glTF JSON — the same field
 * tests/vendored-assets.test.ts reads to build its bone-name overlap check.
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function glbNodeNames(bytes) {
  const { json } = readGlb(bytes);
  return (json.nodes ?? []).map((n) => n.name ?? '');
}

/**
 * Fraction of `candidateNames` that also appear in `referenceNames`, by name —
 * the same `shared / candidate.length` convention tests/vendored-assets.test.ts
 * already uses for the hair/anim-vs-body overlap check. An empty candidate list
 * has nothing to share, so it scores 0 rather than a divide-by-zero NaN.
 * @param {string[]} candidateNames
 * @param {string[]} referenceNames
 * @returns {number}
 */
export function overlapRatio(candidateNames, referenceNames) {
  if (candidateNames.length === 0) return 0;
  const referenceSet = new Set(referenceNames);
  const shared = candidateNames.filter((n) => referenceSet.has(n)).length;
  return shared / candidateNames.length;
}

/**
 * Sums every `*.glb` file directly inside `dir` and reports how many bytes of
 * headroom remain under `maxBytes` — the same 6 MB combined-payload ceiling
 * tests/vendored-assets.test.ts enforces.
 * @param {string} dir
 * @param {number} [maxBytes]
 * @returns {{ usedBytes: number, maxBytes: number, headroomBytes: number }}
 */
export function payloadHeadroom(dir, maxBytes = 6 * 1024 * 1024) {
  const usedBytes = readdirSync(dir)
    .filter((f) => f.endsWith('.glb'))
    .reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
  return { usedBytes, maxBytes, headroomBytes: maxBytes - usedBytes };
}

// --- CLI -------------------------------------------------------------------
// `node scripts/probe-skeleton-compat.mjs <candidate.glb> [referenceAsset=Male]`
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ASSETS_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

  const candidatePath = process.argv[2];
  const referenceAsset = process.argv[3] ?? 'Male';

  if (!candidatePath) {
    console.error('usage: node scripts/probe-skeleton-compat.mjs <candidate.glb> [referenceAsset=Male]');
    process.exit(1);
  }

  const candidateBytes = readFileSync(candidatePath);
  const referenceBytes = readFileSync(join(ASSETS_DIR, `${referenceAsset}.glb`));

  const candidateNames = glbNodeNames(
    new Uint8Array(candidateBytes.buffer, candidateBytes.byteOffset, candidateBytes.byteLength)
  );
  const referenceNames = glbNodeNames(
    new Uint8Array(referenceBytes.buffer, referenceBytes.byteOffset, referenceBytes.byteLength)
  );
  const referenceSet = new Set(referenceNames);
  const sharedCount = candidateNames.filter((n) => referenceSet.has(n)).length;
  const ratio = overlapRatio(candidateNames, referenceNames);
  const pass = ratio > SKELETON_MATCH_FLOOR;

  console.log(`candidate:  ${candidatePath}`);
  console.log(`reference:  ${referenceAsset}.glb`);
  console.log(`shared/total bone names: ${sharedCount}/${candidateNames.length}`);
  console.log(`overlap ratio: ${ratio.toFixed(4)}`);
  console.log(`floor: ${SKELETON_MATCH_FLOOR}`);
  console.log(`skeleton compatibility: ${pass ? 'PASS' : 'FAIL'}`);

  const { usedBytes, maxBytes, headroomBytes } = payloadHeadroom(ASSETS_DIR);
  console.log(`payload headroom: ${headroomBytes} B (used ${usedBytes} / max ${maxBytes})`);

  process.exit(pass ? 0 : 1);
}
