# Prompt Fighter — Roster, Abilities, Select Screen & Real Character Models

**Date:** 2026-08-04
**Status:** Approved, foundation shipped, character-asset integration in progress

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
name, move intent, whether the meter is full, base damage) it always returns the same
`AbilityOutcome`. A fighter with no matching ability for the current turn falls through to
`emptyOutcome`, which is exactly the legacy pre-abilities behavior — `combat.ts` never has
to special-case "no ability fired."

## 4. Character-select screen

`src/render/select.ts` (`createSelectScreen`) replaces a static portrait grid with **four
live-rendered preview cards** — one per roster fighter, each running the actual
`createFighter` rig from `render/fighter.ts`, not a screenshot:

- Each card owns its own throwaway `THREE.Scene` + `PerspectiveCamera` + the real fighter
  rig, posed `idle` with the fighter's own name on its CRT/screen texture.
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

Three **CC0-licensed** Quaternius packs (public domain, no attribution required), all
sharing ONE Unreal-style skeleton — which is the entire reason the combination works:

| Pack | Provides | Note |
|---|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | the bodies | realistically proportioned (~7 heads), muscular, **zero animations** |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | the clips | includes a real boxing vocabulary |
| Base pack's hairstyles | per-fighter heads | rigged to the same skeleton's head bone |

66 of 67 bone names match between the bodies and the animation library, so the clips drive
the bodies directly and the hair rebinds onto the body skeleton by name. No retargeting
math — which is the step that usually turns a swap like this into twisted limbs.

> **The animation library must be the `Unreal-Godot` export (`UAL1_Standard.glb`).** The
> Godot-only glTF mirror circulating on GitHub uses Blender/Rigify bone names (`DEF-head`,
> `DEF-f_index.03.L`) and shares exactly **one** bone name with the bodies — its clips bind
> to nothing and silently animate nothing at all. `tests/vendored-assets.test.ts` asserts a
> >90% bone-name overlap specifically to stop that export being re-vendored.

CC0 is the same license class the 2026-08-03 spec's "asset policy is scoped, not
asset-free" note already anticipated: no proprietary assets, no attribution-required
assets, nothing that reopens a licensing question for a public MIT-licensed repo.

Both packs are name-your-own-price downloads behind itch.io's interactive flow, so
`scripts/vendor-characters.mjs` does not fetch them automatically — it takes `--base` and
`--anims` paths to the two extracted folders.

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
  vocabulary the procedural rig exposed, so `main.ts`, `combat.ts` and the HUD never learn
  which rig backend is active. Poses with two clips **alternate on each entry**:

  | Pose | Clip(s) | Notes |
  |---|---|---|
  | `idle` | `Sword_Idle` | a combat-ready stance that **loops**, so a fighter waiting out a long turn still breathes |
  | `windup` | `Punch_Jab` frozen at 0.18 | held partway in — a textbook fists-up guard |
  | `attack` | `Punch_Jab` → `Punch_Cross` | alternates, so a long exchange isn't one frame replayed |
  | `guard` | `Punch_Jab` frozen at 0.24 | a block is fists up covering the face, so it holds the same jab a little deeper |
  | `hurt` | `Hit_Head` → `Hit_Chest` | alternates — a fighter that always flinches identically reads as a puppet |
  | `ko` | `Death01` | LoopOnce + clamped, holds the last frame |
  | `win` | `Dance_Loop` | |

  Blend time is **per pose** (`POSE_BLEND`), not one global value: a punch crossfades in
  0.06s or it reads as a shove, while settling back to guard takes 0.22s. A single shared
  blend time was the main reason the first pass felt floaty.

  **On frozen poses.** The Unreal-named library — the only export whose bone names match
  these bodies — has no dedicated fighting-stance clip. `Punch_Jab` passes through a
  textbook guard about a fifth of the way in, so `windup` and `guard` seek to a fraction of
  it and pause (`POSE_FREEZE`), pinned every tick while the mixer keeps running so the
  crossfade into them still completes. The fractions were chosen by rendering the clip at
  several points and looking at them.

  Both poses previously used the rig's crouch. `windup` fires at the start of *every* turn,
  making it the most-visible pose in the match, and it read as the fighter squatting rather
  than loading up; `guard` read as ducking rather than blocking. Hence both moved to the
  held jab.
- Brand color is applied via **material tinting**, not geometry or texture swap: the stock
  materials are cloned per fighter and recolored to the brand hue with an emissive rim, the
  same way the procedural rig's `color`/`accent`/`trim` fields worked. One shared mesh
  serves all four fighters — no per-brand texture asset to vendor or maintain.
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
- The CRT/terminal streaming-text billboard survives unchanged in spirit: a
  canvas-textured plane that renders the model's actual streaming reply with a blinking
  cursor. It stops being the fighter's *head* (there is now a real head bone) and becomes
  a camera-facing billboard floated above it instead.

### Trim-for-size pipeline

The library ships as a `.gltf` + `.bin` pair carrying 46 clips — driving, swimming, pistol
handling, sitting, farming — of which this game plays eight. `scripts/gltf-to-glb.mjs`
(`packGltfToGlb`) first inlines the pair into a single GLB and drops every image/texture
reference (each material here is a flat brand tint, so the atlas is dead weight), then the
trimmer removes the clips the pose map never asks for.

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
and fails outright if the payload would exceed the 5MB budget.

The result under `public/assets/characters/`:

| Asset | Size | Note |
|---|---|---|
| `Male.glb` | 0.74MB | body, no clips |
| `Female.glb` | 1.01MB | body, no clips |
| `Hair_SimpleParted / Beard / Buzzed / Long` | 0.38MB total | one per fighter |
| `Anims.glb` | 7.62MB → 2.20MB | 43 clips trimmed to 10, shared by every body |
| **Total** | **4.33MB** | budget 6MB |

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
