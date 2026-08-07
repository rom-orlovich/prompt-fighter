# Prompt Fighter — Roster, Abilities, Select Screen & Real Character Models

**Date:** 2026-08-04
**Status:** Approved, foundation shipped, character-asset integration shipped and tested (G17-G23 merged)

> The roster stops being four palette swaps and starts being four fighters.

## 1. Scope

The 2026-08-03 design spec ([`2026-08-03-prompt-fighter-design.md`](2026-08-03-prompt-fighter-design.md))
covers the core loop: conversation → move → combat resolution → HUD. This doc covers
everything that sits on top of that loop once there is more than one fighter to actually
pick from:

- The 4-fighter roster and what makes each one mechanically distinct.
- The 8 abilities (2 per fighter) layered onto the generic combat resolver.
- The character-select screen the player uses to pick a fighter before a match.
- The move from fully-procedural geometry to real, licensed low-poly character models.
- The deterministic hash that assigns a fighter to a bot-controlled model in replay mode,
  documented explicitly as a decision, not a limitation.

## 2. The roster

Defined in `src/fighters.ts` (`ROSTER`). Four fighters, each with a display name, a brand
color pair (used for lighting, rim glow and, on the vendored rig, material tinting), a
tagline, and a super-move name:

| Fighter | Tagline | Super name |
|---|---|---|
| `CLAUDE` | nuance specialist | CONSTITUTIONAL BARRIER |
| `CODEX` | ships with confidence | CONFIDENT FABRICATION |
| `GEMINI` | context window bully | CONTEXT WINDOW SLAM |
| `LOCAL 7B` | fast and shallow | FAST INFERENCE |

`profileFor(name)` falls back to a generic "unknown model" profile (gray palette, tagline
"unknown model", super name "FINAL ARGUMENT") for any model name that isn't one of the four
— the roster is closed, but the game never refuses to render an opponent it doesn't
recognize.

## 3. Abilities

`src/engine/abilities.ts` layers a mechanical personality on top of the generic combat
resolver from the 2026-08-03 design. Every fighter gets exactly two abilities: one
**passive** that triggers on a specific move shape during a normal turn, and one **super**
that triggers the instant their meter is full (`isSuper`) — the two halves of a kit never
fire on the same turn.

The 8 abilities, 2 per fighter:

| Fighter | Passive | Super |
|---|---|---|
| `CLAUDE` | NUANCE RIPOSTE — heals 12 on a `PARRY` | CONSTITUTIONAL BARRIER — grants 20 shield + heals 15 |
| `CODEX` | SHIP IT RUSH — bonus damage (half the move's power) on an assertive, high-power move | CONFIDENT FABRICATION — 18 bonus damage, but 10 self-damage |
| `GEMINI` | MULTIMODAL RECALL — +15 meter on a `CRIT` | CONTEXT WINDOW SLAM — 12 bonus damage + drains 10 credibility directly from the defender |
| `LOCAL 7B` | QUANTIZED GLITCH — +6 damage on a `JAB`, but 4 self-damage every time | FAST INFERENCE — +20 meter, 8 self-damage |

`applyAbilities(ctx)` is pure and deterministic: given the same `AbilityContext` (fighter
name, move intent, whether the meter is full, base damage, combo length) it always returns
the same `AbilityOutcome`. A fighter with no matching ability for the current turn falls
through to `emptyOutcome`, which is exactly the legacy pre-abilities behavior — `combat.ts`
never has to special-case "no ability fired."

**A combo chain also earns the super (G20b).** A fighter's super used to fire on exactly one
condition — a full meter (`isSuper`). `applyAbilities` now ORs in a second, additive
condition: `ctx.comboLength >= COMBO_SPECIAL_CHAIN_THRESHOLD` (4, chosen to sit one below the
presentation-escalation cap and at-or-past the chain-heavy-reaction threshold in `main.ts`,
so a combo long enough to earn it always already reads as the fight's most dramatic hit tier
— see the constant's own doc comment for the full reasoning). `combat.ts` hands in
`comboLength: atk.combo` — the same counter `comboDamage`'s own multiplier already reads —
purely as data; `isSuper`, `baseDamage` and every damage/resolution step in `combat.ts` are
byte-for-byte unchanged. The meter-full path is untouched: a super-kind ability's own
`trigger`/`apply` still only ever reads `ctx.isSuper`, satisfied via a *derived* context
(`superGate = ctx.isSuper || comboEarnsSuper`) rather than by redefining what `isSuper` means
anywhere else, so the two trigger conditions are strictly additive and every existing test in
`tests/abilities.test.ts` passes unchanged. A combo-earned turn suppresses passives exactly
like a meter-full turn does (never both halves of a kit at once) and fires the same `ability`
CombatEvent pipeline a meter-full super's own ability half already uses — `hud.announce` plus
the named `fx.special` burst/ring — without the meter-full path's own `super` CombatEvent
(no `legacySuperDamage`, no forced crit, no meter drain to zero): a distinct, visibly
"special" beat, additive on top of whatever the turn's own hit already does.

## 4. Character-select screen

`src/render/select.ts` (`createSelectScreen`) replaces a static portrait grid with **four
live-rendered preview cards** — one per roster fighter, each running the actual
`createFighter` rig from `render/fighter.ts`, not a screenshot:

- Each card owns its own throwaway `THREE.Scene` + `PerspectiveCamera` + the real fighter
  rig, posed `idle`. The fighter's name is printed in the card's own DOM label underneath
  the preview, not on an in-world screen texture — see G13 below.
- All four cards share **one** `requestAnimationFrame` loop — four live WebGL previews cost
  one rAF callback, not four — and that loop skips rendering entirely once the select
  screen is hidden behind the title screen (`container.offsetParent === null`), so idle
  preview rendering never steals frame budget from an in-progress match.
- Click-to-pick: each card is a real `<button>`; clicking it fires `onPick(name)` and
  toggles a `selected` class. There is no drag, no confirm step, no keyboard nav — a single
  click both selects and visually confirms the pick.
- `highlight(p1, p2)` lets the caller mark which two fighters are actually in the ring
  (`is-p1` / `is-p2` classes) independent of the click-selection state, so the screen can
  show "who's fighting now" even for the AI-controlled side the player didn't click.
- `dispose()` tears down all four WebGL contexts (`renderer.dispose()` +
  `forceContextLoss()`) and clears the container — the select screen is not meant to be a
  second class of hidden matches quietly burning GPU state in the background.

## 5. Asset integration: real CC0 character models

The original 2026-08-03 spec deliberately shipped with **zero imported assets** — every
fighter was a procedural low-poly rig (`src/roster/visuals.ts`'s `FIGHTER_VISUALS`) built
from primitive boxes and spheres, specifically to keep the public repo free of any asset
licensing question. That tradeoff is revisited here: the roster now wears real,
CC0-licensed character models instead of primitive geometry, without reopening the
licensing question the original design was protecting against.

### Source

Four **CC0-licensed** Quaternius packs (public domain, no attribution required), all
sharing ONE Unreal-style skeleton — which is the entire reason the combination works:

| Pack | Provides | Note |
|---|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | the bodies | realistically proportioned (~7 heads), muscular, **zero animations** |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | the clips | includes a real boxing vocabulary |
| [Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) (G17) | more clips | fills out the vocabulary UAL1 doesn't have — see the pose table above |
| Base pack's hairstyles | per-fighter heads | rigged to the same skeleton's head bone |

66 of 67 bone names match between the bodies and each animation library, so the clips drive
the bodies directly and the hair rebinds onto the body skeleton by name. No retargeting
math — which is the step that usually turns a swap like this into twisted limbs.

> **Both animation libraries must be the `Unreal-Godot` export (`UAL1_Standard.glb` /
> `UAL2_Standard.glb`).** The Godot-only glTF mirrors circulating on GitHub use
> Blender/Rigify bone names (`DEF-head`, `DEF-f_index.03.L`) and share almost no bone names
> with the bodies — their clips bind to nothing and silently animate nothing at all.
> `tests/vendored-assets.test.ts` asserts a >90% bone-name overlap specifically to stop
> either wrong export being re-vendored.

CC0 is the same license class the 2026-08-03 spec's "asset policy is scoped, not
asset-free" note already anticipated: no proprietary assets, no attribution-required
assets, nothing that reopens a licensing question for a public MIT-licensed repo.

All four packs are name-your-own-price downloads behind itch.io's interactive flow, so
`scripts/vendor-characters.mjs` does not fetch them automatically — it takes `--base`,
`--anims` and `--anims2` paths to the three extracted folders.

#### How the roster got here

The roster first shipped on **KayKit Adventurers** (also CC0, cleanly rigged, four
genuinely distinct characters). It lost the brief: KayKit's adventurers are chibi fantasy
characters — roughly three heads tall, in wizard hats and knight helmets — and the game is
meant to read as a grounded fistfight. Rendering both packs side by side at matched arena
height made it unarguable.

The first replacement used the animation library's own built-in mannequin: realistic
proportions and real punches, but **one mesh worn by all four fighters**, so per-fighter
identity collapsed into tint and scale.

Adding the base-character pack closes that gap. Its free tier ships 2 of the 8 bodies
(Superhero Male and Female) plus hairstyles, so identity is now the **combination**:

| Fighter | Body | Hair | Build |
|---|---|---|---|
| `CLAUDE` | Male | parted | lean, deliberate counter-puncher |
| `CODEX` | Male | bearded | front-foot brawler |
| `GEMINI` | Male | shaven | hulking heavyweight |
| `LOCAL 7B` | Female | long | compact featherweight |

> **Decided 2026-08-05: the free ("Standard") tier is the permanent answer here.** The pack's
> paid tier ships eight bodies and would give each fighter a wholly distinct mesh; it was
> evaluated and **declined**. This is a settled product decision, not a deferred TODO — do not
> re-propose buying the paid tier, and treat "only two base bodies" as a constraint to design
> within rather than a gap to close.

Two bodies × four distinct hairstyles × per-fighter height, build and brand tint. That is
short of four wholly different characters — the pack's paid tier has eight bodies — but the
select screen now shows four fighters nobody would mistake for each other.

### Fighter → build

On top of body and hair, each fighter gets its own `modelScale` (height) and `bulk`
(width/depth). The two bodies are not the same height on their own — Male 1.82, Female
1.78 — so `modelHeight(spec)` reads from the body and `arenaHeight(spec)` is their product:

| Fighter | Body | `modelScale` | `bulk` | Arena height |
|---|---|---|---|---|
| `CLAUDE` | Male (1.82) | 1.79 | 0.97 | 3.26 |
| `CODEX` | Male (1.82) | 1.87 | 1.10 | 3.40 |
| `GEMINI` | Male (1.82) | 2.00 | 1.15 | 3.64 |
| `LOCAL 7B` | Female (1.78) | 1.66 | 0.90 | 2.95 |

`bulk` is deliberately mild (0.9–1.15). A skinned humanoid stretched much past that stops
reading as heavyset and starts reading as broken, so the range is asserted in
`tests/characters.test.ts` rather than left to taste. `arenaHeight(spec)` — height times
scale — is the number that has to land in the band the camera frames.

Arena height is deliberately kept distinct per fighter for the same reason
`FIGHTER_VISUALS.scale` was distinct before: silhouette variety is part of how the game
reads at a glance without subtitles, and a uniform height across every rig would erase the
size cues the original procedural design relied on (GEMINI tall and imposing, LOCAL 7B
compact and quick).

The band (2.8–3.9) comes from the rig this replaced: the procedural fighter put its head at
`y = 3.12`. A first integration pass scaled by ~2× that band and cropped every fighter at
the waist in the recorded demo — which is why `tests/characters.test.ts` asserts the derived
`arenaHeight`, not the raw multiplier.

### Loading and animation

- The rig loads through Three.js's `GLTFLoader` as one `.glb` — a single request shared by
  every fighter, no separate `.bin`/texture fetches.
- Animation runs through `AnimationMixer`. `render/fighter.ts` keeps the exact `PoseName`
  vocabulary the procedural rig exposed (plus two G17 additions — `hurtHeavy`, `dodge` — and
  one G20a addition, `jump` — the vocabulary is additive, not a rename), so `main.ts`,
  `combat.ts` and the HUD never learn which rig backend is active. Poses with more than one
  clip **alternate on each entry**:

  | Pose | Clip(s) | Notes |
  |---|---|---|
  | `idle` | `Sword_Idle` | a combat-ready stance that **loops**, so a fighter waiting out a long turn still breathes |
  | `windup` | `Punch_Jab` frozen at 0.18 | held partway in — a textbook fists-up guard |
  | `attack` | `Punch_Jab` → `Punch_Cross` → `Melee_Hook` | rotates through three, so a long exchange isn't one or two frames replayed (G17 added the hook) |
  | `guard` | `Idle_Shield_Loop` | a real held guard stance (G17) — see below for what it replaced |
  | `hurt` | `Hit_Head` → `Hit_Chest` | alternates — a fighter that always flinches identically reads as a puppet |
  | `hurtHeavy` | `Hit_Knockback` | G17 — reserved for crits, counters and supers, so a blow already staged as dramatic reads as harder than a jab landing |
  | `dodge` | `Slide_Start` frozen at 0.15 | G17 — played on a fighter whose opponent's combo just broke (`comboBreak`, previously unhandled) |
  | `jump` | `Jump_Start`, clamped (holds its last frame) | G20a — played at the recovery beat after a `GRAPPLE` move ("TURNED THE QUESTION"); see below for why `NinjaJump_*` and the 3-part `Jump_Loop`/`Jump_Land` sequence were looked at and rejected |
  | `ko` | `Death01` | LoopOnce + clamped, holds the last frame |
  | `win` | `Dance_Loop` | |

  Blend time is **per pose** (`POSE_BLEND`), not one global value: a punch crossfades in
  0.06s or it reads as a shove, while settling back to guard takes 0.22s. A single shared
  blend time was the main reason the first pass felt floaty.

  **On frozen poses.** The Unreal-named library — the only export whose bone names match
  these bodies — has no dedicated fighting-stance clip. `Punch_Jab` passes through a
  textbook guard about a fifth of the way in, so `windup` seeks to a fraction of it and
  pauses (`POSE_FREEZE`), pinned every tick while the mixer keeps running so the crossfade
  into it still completes. The fraction was chosen by rendering the clip at several points
  and looking at them. `dodge` uses the same technique on `Slide_Start` (G17), but the
  fraction that looked right on an isolated preview rig (~0.4-0.6, a low lean with one arm
  braced toward the ground) turned out wrong in the actual game: on a real GPU, in the
  game's own camera and with the fighter's own facing rotation, that frame reads as having
  fallen down, not ducked — caught on two independent live-match screenshot passes and
  rejected. 0.15, a compact crouch earlier in the clip with the knee still bent under the
  hip, reads as ducking in the same real-match check. The lesson generalizes: a frozen
  frame has to be judged in the render context it actually ships in, not an isolated one.

  **`jump` (G20a).** Two candidate clip sets exist on the same verified-compatible skeleton:
  UAL1's `Jump_Start`/`Jump_Loop`/`Jump_Land` and UAL2's `NinjaJump_Start`/
  `NinjaJump_Idle_Loop`/`NinjaJump_Land`. Both were vendored temporarily and looked at side by
  side, in the real game camera, against the real rig — not an isolated preview. `Jump_Start`,
  clamped on its own last frame, won: it reads as a clean, held knee-up/arms-out mid-air pose.
  `NinjaJump_Start` was rejected because its forward-leaning, arms-swept-back launch reads too
  close to `dodge` (`Slide_Start`, itself a low duck-and-lean) from this same 3/4 camera —
  every pose already in the vocabulary has to stay visually distinct from every other, and
  this pair didn't. Sequencing the full 3-part start/loop/land clip through either source was
  considered and rejected too: `Jump_Start` alone, held on its last frame, already has the
  look a sequenced clip would add, for none of the extra state machinery a genuine
  start→loop→land handoff would need in a rig built around one clip per pose.

  `windup` and the old `guard` both previously used the rig's crouch, then both moved to a
  held jab frame: `windup` fires at the start of *every* turn, making it the most-visible
  pose in the match, and the crouch read as the fighter squatting rather than loading up;
  the frozen-jab `guard` read as ducking rather than blocking. **G17 replaced the frozen jab
  with `Idle_Shield_Loop`**, a clip from Universal Animation Library 2 actually authored as a
  held stance (arms crossed up, covering the head/chest) rather than a punch paused mid-swing
  — the frozen jab was serviceable but visibly the *same* pose as `windup`, just a few frames
  further into the same clip, so a blocked exchange and a loading punch read as identical.
- Brand color is applied via **material cloning**, not geometry or texture swap: the stock
  materials are cloned per fighter and their accent details recolored to the brand hue, the
  same way the procedural rig's `color`/`accent`/`trim` fields worked. One shared mesh serves
  all four fighters — no per-brand texture asset to vendor or maintain. G15 restored the
  body's *surface* maps (normal and metallic-roughness) so a whole-body tint sat on real form
  instead of flat plastic; **G23 went further and restored the body's own base-colour (skin/
  costume) map too**, so the body now reads as its own real texture rather than a flat brand
  tint — identity moved to a fresnel rim glow, a ground glow, a brand-recoloured trunks/briefs
  accent baked into that texture, and per-fighter hair/build. See "Body surface detail (G15)"
  below for what does and does not survive vendoring, and its G23 update for the base-colour
  restoration specifically.
- **Facing.** The rig is authored facing `+Z` (verified by rendering it at 0, ±π/2 and π
  against a marker on the `+X` axis). `facingFor(side)` turns each fighter a quarter turn
  toward its opponent, then back toward the camera by `0.3` rad for the classic 3/4
  fighting-game view. The inherited constant was a half turn, which put p1's back to the
  camera and left p2 facing straight out of the screen.
- **Punch trail.** `fighter.ts` streaks a short additive ribbon along the striking hand's
  last 14 positions while a strike is hot, fading over 0.22s. At 60fps a punch can land
  inside two frames; the streak is what makes it legible as a strike. The hand bone is
  matched by *suffix* (`DEF-hand.R`) — an exact-name match silently fell through to the
  first bone merely containing "hand", which is the left one.
- **The CRT/terminal streaming-text billboard was removed (G13).** It first stopped being
  the fighter's *head* (there is now a real head bone) and became a camera-facing plane
  floated above it instead — but once arena spacing tightened enough for fighters to
  actually close distance and trade blows, that floating plane started sitting on top of
  the fighters' own heads, and the two fighters' billboards overlapped each other
  mid-exchange. It was also pure redundancy: the HUD subtitle strip (`hud.subtitle`, fed by
  the same `onTurnChunk` stream) already rendered the identical streaming text, larger and
  legibly, at the same instant, and the select-screen card's own DOM label already printed
  the fighter's name. Route considered and rejected: relocating the billboard to a
  guaranteed-clear spot (e.g. the arena's outer corners) with anti-overlap clamping — this
  would have kept a moving, camera-facing rectangle whose only content duplicated
  information already on screen, for the ongoing cost of proving two independently
  animated sprites never intersect each other or either fighter. Deleting the sprite
  outright is simpler to keep correct forever: there is nothing left that could reoccupy a
  fighter's head. `createFighter` no longer builds a canvas, texture or `THREE.Sprite` for
  a fighter, `FighterRig.setScreenText` no longer exists, and the streaming reply now has
  exactly one on-screen home: the subtitle strip.

### Trim-for-size pipeline

The library ships as a `.gltf` + `.bin` pair carrying 46 clips — driving, swimming, pistol
handling, sitting, farming — of which this game plays eight. `scripts/gltf-to-glb.mjs`
(`packGltfToGlb`) first inlines the pair into a single GLB and, by default, drops every
image/texture reference (most materials here — hair, eyes, the anim library — are a flat
brand tint or never rendered, so their atlas is dead weight), then the trimmer removes the
clips the pose map never asks for.

**Body surface detail (G15).** The two body meshes are the one exception: they render as
flat, solid-colour mannequins if fully stripped, because the vendor pack's normal and
roughness maps are what give a brand-tinted material any surface form — muscle definition
catching the arena lights, skin that is not uniformly glossy. `packGltfToGlb` grew an opt-in
`keepTextureSlots` + `resolveImageBytes` pair so a caller can selectively SURVIVE specific
material texture slots instead of stripping everything; every other caller (hairstyles, the
animation library) still passes no options and gets the original strip-everything behavior,
covered by `tests/gltf-to-glb.test.ts`.

`scripts/vendor-characters.mjs`'s `packBodyGlb` uses this for the two bodies only:
- Keeps `normalTexture` and `pbrMetallicRoughness.metallicRoughnessTexture` (roughness lives
  in that texture's G channel; `metallicFactor: 0` on the source material means the same
  texture's B channel, read as metalness, is always zeroed — the map is safe to reuse as-is).
- **G23 update — `baseColorTexture` is now also kept.** G15 shipped without it: restoring the
  skin/costume texture would have made all four fighters read as the same skin-toned human and
  erased the ONLY brand-colour identity that existed at the time (`fighter.ts`'s whole-body
  `material.color` tint, keyed to `ROSTER[name].color`). That is no longer the only identity
  carrier — G21 added a fresnel rim glow, a ground glow and per-fighter posture, and the HUD/
  select-card brand colour (nameplate, health bar, card border) was always independent of the
  3D model's own tint — so restoring the real texture became affordable. `tint()` in
  `fighter.ts` now only overwrites `material.color` with the flat brand hue for materials that
  did NOT get a base-colour map back (hair, eyebrows, eyes); the body's own material keeps its
  loaded (white) colour so the texture shows unmultiplied. The vendored texture's own
  near-neutral dark region (a trunks/briefs costume detail baked into the source art) is
  additionally recoloured to the fighter's brand hue via a shader injection in
  `attachRimShader`, so identity picks up a "costume accent" instead of a paint job. See the
  G23 done-marker and `2026-08-03-prompt-fighter-design.md`'s "Skin realism (G23)" subsection
  for the full before/after.
- Downscales the normal/roughness maps (raw normal+roughness for both bodies is ~14MB against
  a 6MB combined budget) to 512×512, and the base-colour map to a narrower 256×256 (a
  photographic skin texture compresses far worse than the smoother normal/roughness maps at the
  same resolution — 512px base-colour alone pushed the combined payload to 6.25MB), with
  ImageMagick (`-strip -define png:compression-level=9`) before handing the bytes to
  `packGltfToGlb`, which embeds them as bufferView-backed images appended after the mesh binary
  — still one self-contained `.glb` per body, no sidecar image files. Measured: combined
  vendored payload is now ~6.00MB decimal (~5.72MiB) against the `6 * 1024 * 1024`-byte
  (6.29MB decimal) ceiling in `tests/vendored-assets.test.ts` — restored without raising the
  budget.

`scripts/trim-glb.mjs` (`trimGlb`) is a zero-dependency GLB trimmer that keeps only the
clips in the pose map and then garbage-collects everything they orphan:

1. Filter `animations` down to the kept clips.
2. Walk what is still referenced — mesh primitive attributes, indices and morph targets,
   `skin.inverseBindMatrices`, and the samplers of the *kept* animations only.
3. Collect the `bufferViews` those accessors need (including `accessor.sparse`), plus any
   image `bufferViews`.
4. Repack the BIN chunk with only those views, 4-byte aligned, rewriting each `byteOffset`.
5. **Rebuild the `accessors` array and remap every reference to it** — meshes, skins and
   animation samplers.
6. Re-emit the GLB with 4-byte-aligned JSON (space-padded) and BIN (zero-padded) chunks.

Step 5 is the one that is easy to skip and expensive to get wrong. Dropping bufferViews
*without* pruning and remapping accessors leaves dangling `accessor -> bufferView`
references: the output is still a plausible-looking file of roughly the expected size, and
it still fails to load. That is why `scripts/validate-glb.mjs` exists and why
`tests/vendored-assets.test.ts` asserts structural validity rather than byte size — a
size-only check passes on a corrupt model.

`scripts/vendor-characters.mjs` drives the whole pipeline (download → pack → trim →
validate → write), refuses to emit a rig that fails validation or keeps the wrong clips,
and fails outright if the payload would exceed budget.

**Two animation sources merged into one library (G17).** Universal Animation Library
(UAL1) covers the original 10-clip set; expanding the move vocabulary needed clips UAL1's
free tier doesn't have, from a *second*, independently-exported pack — Universal Animation
Library 2 (UAL2). `scripts/trim-glb.mjs`'s `mergeAnimGlbs([{glb, keep}, ...])` trims each
source to its own keep-list (same accessor/bufferView compaction `trimGlb` already did for
one source) and concatenates the results into a single `Anims.glb`, taking node/mesh/skin
geometry from the first source only. This only works because it was *verified*, not
assumed, that UAL1 and UAL2's `Unreal-Godot` exports emit the identical 67-node skeleton in
the same order — so an animation channel's `target.node` index means the same bone in
either source and never needs remapping, only the binary sampler data does. `mergeAnimGlbs`
asserts the node arrays match and throws rather than silently mis-animating if a future
source doesn't.

G20a extended `KEEP_CLIPS` (UAL1) with `Jump_Start` the same way — no new merge machinery,
just one more name in an existing keep-list — after the jump pose section above's side-by-side
look ruled out UAL2's `NinjaJump_*` and the 3-part sequence.

The result under `public/assets/characters/`:

| Asset | Size | Note |
|---|---|---|
| `Male.glb` | 1.26MB | body, no clips |
| `Female.glb` | 1.48MB | body, no clips |
| `Hair_SimpleParted / Beard / Buzzed / Long` | 0.37MB total | one per fighter |
| `Anims.glb` | 15.7MB → 2.89MB | UAL1 (10 clips, incl. `Jump_Start` — G20a) + UAL2 (4 clips) trimmed and merged into 15 clips, shared by every body |
| **Total** | **6.00MB** | budget 6MB — `6 * 1024 * 1024` bytes (6.29MB decimal); still fits, matching the ~6.00MB decimal (~5.72MiB) measurement in "Body surface detail (G15)" above |

This keeps the "clone stays small" property of the original procedural design intact even
though the geometry is no longer procedural.

## 6. Deterministic fighter selection — an intentional design decision

`src/engine/selection.ts` decides which roster fighter a bot-controlled side renders as,
using an **FNV-1a 32-bit hash** of the model's normalized name:

```ts
export function hashModelName(modelName: string): number {
  const normalised = normaliseModelName(modelName); // trim + uppercase
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}

export function fighterForModel(modelName: string): FighterId {
  const index = hashModelName(modelName) % FIGHTER_IDS.length;
  return FIGHTER_IDS[index];
}
```

`selectFighter` prefers an explicit `transcriptFighter` value when the replay transcript
already names a known roster id (`selectFighter` in `selection.ts`); the hash is the
fallback for anything else — most importantly, any model name a *live* match names that
isn't one of the four hand-authored roster entries.

**This is a documented design decision for the current replay-based architecture, not a
gap to close later:**

- `engine/` is contractually pure — no `Math.random`, no `Date`, no I/O (see the module's
  own header comment) — so the *same* model name must always resolve to the *same*
  fighter, every run, on every machine, with zero shared state. A hash is the only
  mechanism that satisfies "deterministic" and "stateless" at the same time; a random or
  round-robin assignment would violate the engine's own no-randomness contract, and a
  stored mapping would violate the no-I/O contract.
- The replay source ships bundled transcripts that already name their fighters explicitly
  (`transcriptFighter`), so the hash path is the fallback for the uncommon case, not the
  common one — for the demo build (the only build with no API key requirement) the hash
  essentially never actually decides anything, because every bundled transcript already
  supplies a known fighter name.
- For the deferred live-model mode (see the 2026-08-03 spec's Scope section), the hash is
  what lets an arbitrary OpenRouter model name — one that was never hand-authored into the
  4-entry roster — still get a consistent, repeatable visual identity across a session
  without a database, a config file, or a runtime registration step. A mirror match (both
  sides hashing to the same fighter) is legal and expected, not a bug: two different model
  names can share a hash bucket, and the roster is intentionally small (4 fighters), so
  collisions are a known, accepted tradeoff of keeping the roster hand-curated rather than
  auto-generated per model.

## 7. Testing

Same discipline as the rest of `engine/`: `abilities.ts` and `selection.ts` are pure
functions, unit-tested table-driven under `vitest` with no DOM and no Three.js. The
character-select screen and the rig loading are verified by running the game (per
the existing "Rendering is verified by running the game, not by unit tests" rule from the
2026-08-03 spec), with `tests/characters.test.ts` covering the pure data layer
(`roster/characters.ts`'s fighter → model → scale/skin mapping) the same way
`roster/visuals.ts` was already covered before this doc.

The vendored rig is covered by `tests/vendored-assets.test.ts`: present, **structurally
valid** (every accessor/bufferView/sampler/node reference resolves), exactly the vendored
clip set, inside the payload budget, and — importantly — carrying *every* clip the pose map
can ask for, which guards the failure mode where a pose silently falls through to "keep
whatever is playing" because its clip was trimmed away.

### Recording the demo needs a real GPU

`e2e/demo-recording.test.ts` drives the real render loop with no `?fast=1`, so unlike the
rest of the suite it depends on actual rendering throughput. Under headless software
rendering (SwiftShader/llvmpipe) the scene runs at roughly 2fps; because `scene.ts` clamps
each frame delta to 0.05s, the arcade clock then advances about 0.1s per real second and
the match never meaningfully progresses — the round timer stays pinned at its opening `99`
no matter how long the spec waits.

That is a *rendering-throughput* limit, not a bug in the clock: on a real GPU the same
build runs at ~57fps and the timer counts down normally. The spec detects a software
rasteriser and skips itself rather than asserting something weaker that would pass without
proving anything, so `npx playwright test` stays green in CI. To actually record:

```
npx playwright test e2e/demo-recording.test.ts --headed
```

The demo under `demo/` is produced this way, then verified by extracting frames and
checking them by eye — a valid video file with the wrong content (a black void, a mirror
match, a frozen clock) is exactly the failure this whole spec exists to prevent.

**What a real run reports (measured 2026-08-07).** This self-skip is not unique to
`demo-recording.test.ts`: **5 of the e2e suite's 23 specs** gate on the same software-rasteriser
check. So `npx playwright test` on a GPU-less host is **18 passed / 5 skipped** — the honest
ceiling there, not a partial failure. `--headed` does not change it: it launches fine given any
X server, but an `Xvfb`-style display is still software rendering, so the same 5 skip. Reaching
23/23 requires an actual GPU. The 2026-08-03 design spec's §5 once claimed a flat "18/18 headed,
real GPU, `--workers=2` all green"; it now carries the same split (updated for the current
23-spec count) plus the contention measurements behind `playwright.config.ts`'s `workers`/
`retries` settings, so the two docs no longer disagree. Unit tests are host-independent:
**240 vitest specs** as of 2026-08-07 (186 as of 2026-08-06).
