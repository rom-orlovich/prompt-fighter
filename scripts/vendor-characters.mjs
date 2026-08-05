#!/usr/bin/env node
/**
 * Vendors the fighter bodies, hairstyles and animation clips into
 * `public/assets/characters/`.
 *
 * Four CC0 Quaternius sources, all sharing ONE Unreal-style skeleton, which is
 * the whole reason this combination works:
 *
 *   - Universal Base Characters — the bodies. Realistically proportioned
 *     (~7 heads), muscular, and shipped with ZERO animations.
 *   - Universal Animation Library — the clips, including a real boxing
 *     vocabulary (`Punch_Jab`, `Punch_Cross`, `Hit_Head`, `Hit_Chest`).
 *   - Universal Animation Library 2 (G17) — a second, independently-exported
 *     clip pack that fills out the vocabulary the first pack doesn't have: a
 *     third punch (`Melee_Hook`), a heavy hit reaction (`Hit_Knockback`), a
 *     real guard stance (`Idle_Shield_Loop`) and a dodge (`Slide_Start`).
 *     Verified byte-for-byte identical node ordering/naming to UAL1's export
 *     (see `mergeAnimGlbs` in `trim-glb.mjs`), so its clips drive the same
 *     bodies with no extra retargeting step.
 *   - The base pack's hairstyles, rigged to the head bone.
 *
 * 66 of 67 bone names match between the bodies and each animation library, so
 * the clips drive the bodies directly and the hair rebinds onto the body
 * skeleton by name — no retargeting math, which is the step that usually turns
 * a swap like this into twisted limbs.
 *
 * NOTE both animation libraries must be the **Unreal-Godot** export
 * (`UAL1_Standard.glb` / `UAL2_Standard.glb`). The Godot-only mirrors floating
 * around GitHub use Blender/Rigify bone names (`DEF-head`, `DEF-f_index.03.L`)
 * and share almost no bone names with the bodies — their clips silently
 * animate nothing.
 *
 * License: CC0 1.0 for all four packs (no attribution required).
 *   https://quaternius.itch.io/universal-base-characters
 *   https://quaternius.itch.io/universal-animation-library
 *   https://quaternius.itch.io/universal-animation-library-2
 *
 * All are name-your-own-price downloads behind itch.io's interactive flow, so
 * they are not fetched automatically. Download and unzip them, then point this
 * script at the extracted folders:
 *
 *   node scripts/vendor-characters.mjs \
 *     --base "/path/to/Universal Base Characters[Standard]" \
 *     --anims "/path/to/Universal Animation Library[Standard]" \
 *     --anims2 "/path/to/Universal Animation Library 2[Standard]"
 *
 * Deterministic: unchanged inputs produce byte-identical output.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { packGltfToGlb, readGlb } from './gltf-to-glb.mjs';
import { mergeAnimGlbs } from './trim-glb.mjs';
import { validateGlbStructure } from './validate-glb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'characters');

/** The two body meshes the free tier ships. */
export const BODIES = ['Male', 'Female'];

/** Hairstyles, one per fighter, so four fighters on two bodies still read apart. */
export const HAIRSTYLES = ['Hair_SimpleParted', 'Hair_Beard', 'Hair_Buzzed', 'Hair_Long'];

/**
 * The clips the game plays, from Universal Animation Library (UAL1). Keep in
 * sync with `POSE_CLIPS` in `src/render/fighter.ts` and with
 * `tests/vendored-assets.test.ts`.
 *
 * `Punch_Enter` is deliberately absent — it exists only in the Godot-named
 * export, which cannot drive these bodies.
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
  'Walk_Loop',
  // `Jump_Start` (G20a) — a real jump, vendored from UAL1. `Jump_Loop`/`Jump_Land`
  // were looked at too (see the G20 done-marker) and rejected: `Jump_Start`
  // clamp-held on its own last frame already reads as a clean, held mid-air
  // pose, so sequencing a 3-part start/loop/land clip through this rig's
  // single-clip-per-pose machinery would add real complexity for a look that's
  // already there in one clip. UAL2's `NinjaJump_*` was looked at side by side
  // too and rejected: its launch leans the torso forward with the arms swept
  // back, which reads too close to `dodge` (`Slide_Start`, a low duck-and-lean)
  // from this same 3/4 camera — `Jump_Start`'s knee-driven vertical launch
  // stays clearly distinct from every other pose already in the vocabulary.
  'Jump_Start'
];

/**
 * The clips the game plays, from Universal Animation Library 2 (UAL2, G17).
 * Everything the free tier advertises beyond this was measured and rejected —
 * see the G17 done-marker for what was looked at and why it didn't ship
 * (mostly: the pack's "combo" clips are sword combos, and a swordless
 * fighter playing them reads as flailing at nothing).
 *
 *   `Melee_Hook`        — a real third punch, joining `Punch_Jab`/`Punch_Cross`.
 *   `Hit_Knockback`     — a heavy hit reaction for crits/counters/supers.
 *   `Idle_Shield_Loop`  — a real guard stance (arms up), replacing the old
 *                         frozen-mid-jab `guard` pose.
 *   `Slide_Start`       — a dodge/evade, played on the opponent when a
 *                         fighter's combo breaks.
 */
export const KEEP_CLIPS_2 = ['Melee_Hook', 'Hit_Knockback', 'Idle_Shield_Loop', 'Slide_Start'];

const MAX_COMBINED_BYTES = 6 * 1024 * 1024;

/**
 * Downscale target for the body normal/roughness maps (G15). Source maps are
 * ~1.3k-2k px and ~3-4MB EACH; raw normal+roughness for both bodies is ~14MB
 * against a 6MB total budget, so shipping them untouched is impossible.
 * 512x512 keeps visible muscle definition and non-uniform specular while the
 * combined vendored payload stays comfortably under budget (measured: ~848KB
 * for all four body maps combined, vs. the ~2.5MB+ of headroom the current
 * 4.33MB non-body payload leaves under the 6MB ceiling).
 */
const BODY_TEXTURE_RESOLUTION = 512;

/**
 * Downscale target for the restored base-colour (skin/costume) map alone
 * (G23) — narrower than `BODY_TEXTURE_RESOLUTION` on purpose. At 512px the
 * two base-colour maps alone cost ~366KB combined (measured: PNG compresses
 * a photographic skin texture far worse than the smoother normal/roughness
 * maps at the same resolution), which pushed the combined payload to
 * 6.25MB against the 6MB budget that was already nearly full; 320px still
 * landed at 6.05MB. 256px keeps visible costume/skin detail — this is a
 * UV-mapped diffuse read at arena/select-card distance, not a close-up
 * texel inspection — while costing ~118KB combined, fitting the restored
 * maps in the ~370KB of headroom the pre-G23 5.88MB payload left under
 * budget with margin to spare.
 */
const BODY_BASE_COLOR_RESOLUTION = 256;

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

/** Downscales a source PNG with ImageMagick and returns its bytes. */
function downscalePng(srcPath, resolution = BODY_TEXTURE_RESOLUTION) {
  const outPath = join(tmpdir(), `vendor-tex-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  execFileSync('convert', [
    srcPath,
    '-strip',
    '-resize',
    `${resolution}x${resolution}`,
    '-define',
    'png:compression-level=9',
    '-define',
    'png:compression-filter=5',
    outPath
  ]);
  try {
    return new Uint8Array(readFileSync(outPath));
  } finally {
    rmSync(outPath, { force: true });
  }
}

/**
 * The body's base-colour (skin/costume) source file, per body — G23. Not a
 * uniform `T_Superhero_${body}_Dark.png` template: the Male pack's file is
 * named `_Dark.png` but the Female pack's is `_Dark_BaseColor.png` (verified
 * against the extracted pack, not assumed), so this is an explicit map
 * rather than a derived name.
 */
const BODY_BASE_COLOR_URI = {
  Male: 'T_Superhero_Male_Dark.png',
  Female: 'T_Superhero_Female_Dark_BaseColor.png'
};

/**
 * Packs a body `.gltf` + `.bin` pair, restoring its normal, metallic-roughness
 * AND base-colour maps (all downscaled) so the fighter reads as a real body
 * under lighting — a real skin/costume texture, not a flat brand-colour
 * paint (G23; see the G23 done-marker for why the G15-era stripped-base-colour
 * trade was reopened: G21 added identity carriers — the rim glow, ground glow
 * and per-fighter accents in `fighter.ts` — that don't need whole-body paint
 * to read, which is what made restoring the skin texture affordable). The
 * same source gltf also carries stub hair/eye materials; their maps are
 * deliberately left stripped, so only the three body-named textures are kept.
 */
function packBodyGlb(dir, name, outName, body) {
  const gltf = JSON.parse(readFileSync(join(dir, `${name}.gltf`), 'utf8'));
  const bin = new Uint8Array(readFileSync(join(dir, `${name}.bin`)));

  const baseColorUri = BODY_BASE_COLOR_URI[body];
  const allowedUris = new Set([`T_Superhero_${body}_Normal.png`, `T_Superhero_${body}_Roughness.png`, baseColorUri]);
  const downscaledByUri = new Map();

  const glb = packGltfToGlb(gltf, bin, {
    keepTextureSlots: new Set(['normalTexture', 'metallicRoughnessTexture', 'baseColorTexture']),
    resolveImageBytes: (image) => {
      if (!image.uri || !allowedUris.has(image.uri)) return undefined;
      if (!downscaledByUri.has(image.uri)) {
        const resolution = image.uri === baseColorUri ? BODY_BASE_COLOR_RESOLUTION : BODY_TEXTURE_RESOLUTION;
        downscaledByUri.set(image.uri, downscalePng(join(dir, image.uri), resolution));
      }
      return downscaledByUri.get(image.uri);
    }
  });
  const { valid, errors } = validateGlbStructure(glb);
  if (!valid) throw new Error(`${outName}: failed structural validation: ${errors.join('; ')}`);
  writeFileSync(join(OUT_DIR, outName), glb);
  return glb.byteLength;
}

function main() {
  const baseDir = arg('--base');
  const animsDir = arg('--anims');
  const anims2Dir = arg('--anims2');
  if (!baseDir || !animsDir || !anims2Dir) {
    throw new Error(
      'need --base <Universal Base Characters[Standard]>, --anims <Universal Animation Library[Standard]> ' +
        'and --anims2 <Universal Animation Library 2[Standard]>'
    );
  }

  const bodySrc = join(baseDir, 'Base Characters', 'Godot - UE');
  const hairSrc = join(baseDir, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
  const animSrc = join(animsDir, 'Unreal-Godot', 'UAL1_Standard.glb');
  const anim2Src = join(anims2Dir, 'Unreal-Godot', 'UAL2_Standard.glb');
  for (const p of [bodySrc, hairSrc, animSrc, anim2Src]) {
    if (!existsSync(p)) throw new Error(`missing expected pack path: ${p}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  let combined = 0;

  for (const body of BODIES) {
    const bytes = packBodyGlb(bodySrc, `Superhero_${body}_FullBody`, `${body}.glb`, body);
    combined += bytes;
    console.log(`${`${body}.glb`.padEnd(24)} ${(bytes / 1e6).toFixed(2)}MB`);
  }

  for (const hair of HAIRSTYLES) {
    const bytes = packPair(hairSrc, hair, `${hair}.glb`);
    combined += bytes;
    console.log(`${`${hair}.glb`.padEnd(24)} ${(bytes / 1e6).toFixed(2)}MB`);
  }

  // Both animation libraries are already GLBs; each carries dozens of clips
  // this game never plays (driving, swimming, pistols, farming, zombies,
  // sword combos). `mergeAnimGlbs` trims each to its own KEEP list and
  // combines them into one clip library the loader treats as a single file
  // (see its doc comment in trim-glb.mjs for why this is safe: both packs
  // export the identical node hierarchy).
  const raw1 = new Uint8Array(readFileSync(animSrc));
  const raw2 = new Uint8Array(readFileSync(anim2Src));
  const rawCombinedBytes = raw1.byteLength + raw2.byteLength;
  const trimmed = mergeAnimGlbs([
    { glb: raw1, keep: KEEP_CLIPS },
    { glb: raw2, keep: KEEP_CLIPS_2 }
  ]);
  const { valid, errors } = validateGlbStructure(trimmed);
  if (!valid) throw new Error(`Anims.glb failed structural validation: ${errors.join('; ')}`);

  const clips = (readGlb(trimmed).json.animations ?? []).map((a) => a.name).sort();
  const expected = [...KEEP_CLIPS, ...KEEP_CLIPS_2].sort();
  if (clips.join() !== expected.join()) {
    throw new Error(`Anims.glb kept the wrong clips: ${clips.join(', ')}`);
  }
  writeFileSync(join(OUT_DIR, 'Anims.glb'), trimmed);
  combined += trimmed.byteLength;
  console.log(
    `${'Anims.glb'.padEnd(24)} ${(rawCombinedBytes / 1e6).toFixed(2)}MB -> ` +
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
