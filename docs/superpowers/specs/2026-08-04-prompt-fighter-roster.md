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
color pair (used for lighting, rim glow and — once the KayKit models land — material
tinting), a tagline, and a super-move name:

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

**KayKit Adventurers** by Kay Lousberg — a free, **CC0-licensed** (public domain, no
attribution required) low-poly character pack, distributed at
`https://kaylousberg.itch.io/kaykit-adventurers`. CC0 is the same license class the
2026-08-03 spec's "asset policy is scoped, not asset-free" note already anticipated: no
proprietary assets, no attribution-required assets, nothing that reopens a licensing
question for a public MIT-licensed repo.

### Fighter → model → scale

Each fighter is assigned one of the pack's pre-rigged character classes, matched to its
existing silhouette/personality from `roster/visuals.ts`.

The vendored models are **not** all the same height on their own — they range from 2.37 to
2.98 world units in the Idle pose — so a shared scale factor would render them at wildly
different on-screen sizes. `CharacterSpec` therefore records each model's measured
`modelHeight` alongside its `modelScale`, and `arenaHeight(spec)` (their product) is the
number that actually has to land in the band the camera is framed for:

| Fighter | KayKit model | Why this model | `modelHeight` | `modelScale` | Arena height |
|---|---|---|---|---|---|
| `CLAUDE` | Mage | round, contemplative, "nuance specialist" reads as the careful spellcaster, not the brawler | 2.976 | 1.09 | 3.24 |
| `CODEX` | Knight | "ships with confidence" — armored, plants itself and swings first | 2.44 | 1.39 | 3.39 |
| `GEMINI` | Barbarian | hulking and imposing — "overwhelms the arena with sheer context" | 2.371 | 1.54 | 3.65 |
| `LOCAL 7B` | Rogue | small, quick, "fast and shallow" — the lightest and quickest-reading rig in the pack | 2.585 | 1.14 | 2.95 |

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

- Models load through Three.js's `GLTFLoader`, as `.glb` (binary glTF) — one HTTP request
  per fighter, no separate `.bin`/texture fetches.
- Animation runs through Three.js's `AnimationMixer` against clips baked into each rig.
  `render/fighter.ts` keeps the exact `PoseName` vocabulary the procedural rig exposed, so
  `main.ts`, `combat.ts` and the HUD never learn whether a build is running the procedural
  rig or a KayKit one. The mapping — and the full set of clips the trimmer keeps — is:

  | Pose | KayKit clip |
  |---|---|
  | `idle` | `Idle` |
  | `windup` | `Blocking` |
  | `attack` | `Unarmed_Melee_Attack_Punch_A` |
  | `guard` | `Block` |
  | `hurt` | `Hit_A` |
  | `ko` | `Death_A` (LoopOnce + `clampWhenFinished`, so a K.O. holds its last frame) |
  | `win` | `Cheer` |

  The pack ships genuine **unarmed** melee clips, which is what makes a fistfight read as a
  fistfight rather than a weapon-swing animation played without a weapon.
- Brand color is applied via **material tinting**, not geometry swap or texture swap: the
  stock KayKit materials are recolored to the fighter's brand hue with an emissive rim,
  the same way the procedural rig's `color`/`accent`/`trim` fields worked. One rig per
  fighter serves every model — there's no separate texture asset per brand color to
  vendor or maintain.
- The CRT/terminal streaming-text billboard survives unchanged in spirit: a
  canvas-textured plane that renders the model's actual streaming reply with a blinking
  cursor. It stops being the fighter's *head* (there is now a real head bone) and becomes
  a camera-facing billboard floated above it instead.

### Trim-for-size pipeline

The pack publishes each character as a ready-made `.glb` under `Characters/gltf/`, so no
`.gltf` + `.bin` packing step is needed. What *is* needed is a trim: each source file is
~3.6MB, and **1.33MB of that is 76 animation clips** covering swordplay, archery, spell-
casting, sitting, jumping and more. This game plays exactly seven of them.

`scripts/trim-glb.mjs` (`trimGlb`) is a zero-dependency GLB trimmer that keeps only the
clips in the pose map and then garbage-collects everything they orphan:

1. Filter `animations` down to the seven kept clips.
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

`scripts/vendor-characters.mjs` drives the whole pipeline (download → trim → validate →
write), refuses to emit a model that fails validation or keeps the wrong clips, and fails
outright if the combined payload would exceed the 5MB budget.

The result is a self-contained `.glb` per fighter under `public/assets/characters/`:

| Model | Source | Vendored | Saving |
|---|---|---|---|
| Barbarian | 3.61MB | 0.62MB | −83.0% |
| Knight | 3.66MB | 0.66MB | −81.9% |
| Mage | 3.59MB | 0.59MB | −83.5% |
| Rogue | 3.62MB | 0.62MB | −82.9% |
| **Total** | **14.48MB** | **2.49MB** | **−82.8%** |

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
character-select screen and the KayKit rig loading are verified by running the game (per
the existing "Rendering is verified by running the game, not by unit tests" rule from the
2026-08-03 spec), with `tests/characters.test.ts` covering the pure data layer
(`roster/characters.ts`'s fighter → model → scale/skin mapping) the same way
`roster/visuals.ts` was already covered before this doc.

The vendored assets themselves are covered by `tests/vendored-assets.test.ts`: all four
models present, **structurally valid** (every accessor/bufferView/sampler/node reference
resolves), exactly the seven pose-mapped clips, and a combined payload under 5MB.

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
