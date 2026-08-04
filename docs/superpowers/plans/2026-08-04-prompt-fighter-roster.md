# Prompt Fighter Roster & Real Character Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-fighter proof of concept from
[`2026-08-03-prompt-fighter-poc.md`](2026-08-03-prompt-fighter-poc.md) into a real 4-fighter
roster: a distinct silhouette, tagline and two abilities per fighter, a character-select
screen the player actually clicks through, and — as the current milestone — real CC0 KayKit
character models in place of the original fully-procedural rig, without touching the
pure `engine/` combat contract those fighters plug into.

**Design reference:** [`2026-08-04-prompt-fighter-roster.md`](../specs/2026-08-04-prompt-fighter-roster.md)
(this plan's companion spec) for the full roster table, the 8-ability catalog, the
character-select screen's behavior, the KayKit asset pipeline, and the FNV-1a deterministic
selection decision.

**Tech Stack:** Same as the POC — TypeScript, Vite, Three.js, Vitest. Character models add
exactly one new build-time dependency shape: vendored `.glb` binaries under
`assets/characters/`, produced by a local zero-dependency packer script rather than a new
npm package.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/fighters.ts` | `ROSTER` — the 4 hand-authored `FighterProfile`s (name, color, tagline, superName, visual) |
| `src/roster/visuals.ts` | `FIGHTER_VISUALS` — pure per-fighter silhouette/scale/color data for the procedural rig |
| `src/roster/characters.ts` | `CHARACTERS` / `CHARACTER_MODELS` — pure per-fighter KayKit model + skin tint + model scale data |
| `src/engine/abilities.ts` | `ABILITIES` / `FIGHTER_ABILITIES` / `applyAbilities` — the 8-ability catalog and its pure resolution against `AbilityContext` |
| `src/engine/selection.ts` | `hashModelName` / `fighterForModel` / `selectFighter` / `selectMatchup` — deterministic model→fighter assignment |
| `src/render/select.ts` | `createSelectScreen` — 4 live-rendered preview cards, click-to-pick, shared rAF loop |
| `src/render/fighter.ts` | `createFighter` — the rig factory; grows a `GLTFLoader`/`AnimationMixer` path alongside the existing procedural path |
| `scripts/gltf-to-glb.mjs` | `packGltfToGlb` / `readGlb` — strips textures/extra UV/vertex-color, inlines the `.bin`, emits a small `.glb` |
| `tests/characters.test.ts` | Table-driven coverage of `roster/characters.ts` |
| `tests/gltf-to-glb.test.ts` | Round-trip coverage of the GLB packer against a synthetic textured glTF fixture |
| `tests/selection.test.ts` | Table-driven coverage of the FNV-1a hash and fighter assignment |
| `e2e/select-screen.test.ts` | Playwright coverage that the select screen actually renders 4 distinct fighters and a click picks one |

---

## Tasks

### 1. Roster and ability foundation (shipped — commit `7715187`)

- [x] Define `ROSTER` in `src/fighters.ts`: 4 fighters, each with `name`, `color`, `accent`,
      `tagline`, `superName`, and a `visual` sourced from `roster/visuals.ts`.
      `profileFor(name)` falls back to a generic gray "unknown model" / "FINAL ARGUMENT"
      profile for any unrecognized name.
- [x] Define `FIGHTER_VISUALS` in `src/roster/visuals.ts`: pure per-fighter silhouette data
      (head shape, scale, torso/limb dimensions, screen resolution) so `render/fighter.ts`
      can build a distinct procedural rig per fighter with no Three.js/DOM dependency in
      the data layer itself.
- [x] Define the 8-ability catalog in `src/engine/abilities.ts`: one passive + one super per
      fighter, `applyAbilities(ctx)` pure and deterministic, passives and supers mutually
      exclusive per turn (`isSuper` gate), unrecognized fighters resolve to
      `emptyOutcome` (legacy pre-abilities behavior) rather than an error.
- [x] Define deterministic fighter selection in `src/engine/selection.ts`: FNV-1a 32-bit
      hash over the normalized model name, `selectFighter` preferring an explicit
      `transcriptFighter` when it names a known roster id, falling back to the hash
      otherwise. Zero `Math.random`, zero `Date`, zero I/O — same contract as the rest of
      `engine/`.
- [x] Build the character-select screen in `src/render/select.ts`: one live `THREE.Scene` +
      `createFighter` rig per card, one shared `requestAnimationFrame` loop across all 4
      cards, click-to-pick via a real `<button>`, `highlight(p1, p2)` for marking the
      active matchup independent of the click state, `dispose()` releasing all 4 WebGL
      contexts.
- [x] Cover `abilities.ts` and `selection.ts` with table-driven `vitest` cases; cover the
      select screen's rendering behavior with a Playwright `e2e/select-screen.test.ts`.

### 2. Real character models — KayKit integration (shipped)

- [x] Vendor the KayKit Adventurers pack's Mage / Knight / Barbarian / Rogue rigs (CC0).
      Taken from the pack's official GitHub mirror
      (`KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`), which publishes each
      character as a ready-made `.glb` — so no `.gltf` + `.bin` packing step was needed
      after all, only a trim. `scripts/vendor-characters.mjs` downloads, trims, validates
      and writes `public/assets/characters/<model>.glb`.
- [x] Write `src/roster/characters.ts`: `CHARACTERS` mapping each of the 4 fighters to a
      `CharacterSpec` (`model`, `description`, `skin` — equal to `ROSTER[name].color` —
      plus `modelHeight` and `modelScale`). `characterFor(name)` falls back to a generic
      character for an unrecognized model, the same shape as `profileFor` in
      `fighters.ts`. `characterAssetUrl(model, base)` resolves a vendored model id to a
      local, same-origin `.glb` path — never an external URL.
- [x] Write `scripts/trim-glb.mjs`'s `trimGlb`: keep only the 7 pose-mapped clips, then
      prune and remap the accessors and bufferViews they orphan, and re-emit a
      4-byte-aligned glTF-2.0 GLB. Paired with `readGlb` so it is round-trip-testable with
      no browser and no GPU. `scripts/validate-glb.mjs` checks structural integrity,
      because a trimmed file of the right *size* can still carry dangling references.
- [x] Run the trimmer over all 4 rigs: **14.48MB → 2.49MB combined (−82.8%)**, comfortably
      under the 5MB budget. `tests/vendored-assets.test.ts` asserts presence, structural
      validity, clip set and combined size.
- [x] Extend `render/fighter.ts`'s `createFighter` to load a KayKit `.glb` via `GLTFLoader`
      and drive it with `AnimationMixer`, mapped onto the same `PoseName` vocabulary the
      procedural rig exposed, so `main.ts`, `combat.ts` and the HUD stay agnostic to which
      rig backend is active. `createFighter` stays synchronous and returns the identical
      `FighterRig` shape — `main.ts` and `render/select.ts` needed zero changes.
- [x] Apply brand-color material tinting (fighter's `color`/`accent` plus an emissive rim)
      to the loaded KayKit materials — no geometry swap, no per-color texture variant.
- [x] Re-home the CRT streaming-text billboard from "is the head" to "camera-facing plane
      floated above the head bone" now that a real head exists on the rig.
- [x] Cover the pure data + tooling layers with table-driven `vitest` cases
      (`tests/characters.test.ts`, `tests/trim-glb.test.ts`, `tests/gltf-to-glb.test.ts`,
      `tests/vendored-assets.test.ts`); verify the loaded, animated, tinted rig by running
      the game, per the existing "rendering is verified by running the game" rule.
- [x] Add `e2e/demo-recording.test.ts` (no `?fast=1`, two different fighters, live timer)
      and re-record `demo/prompt-fighter-roster-demo.{webm,mp4}` from it. Needs a real GPU
      (`--headed`); the spec skips itself under a software rasteriser — see the design
      spec's "Recording the demo needs a real GPU".

### 3. Documentation

- [x] Write the companion design spec,
      [`2026-08-04-prompt-fighter-roster.md`](../specs/2026-08-04-prompt-fighter-roster.md):
      roster table, ability catalog, select-screen behavior, KayKit asset-integration
      approach (source, fighter→model→scale table, loading/animation, trim pipeline), and
      the FNV-1a deterministic-selection decision documented as an intentional design
      choice for the current replay-based architecture.
- [x] Write this plan, mirroring the file-structure-table + checkbox-task-breakdown
      structure of [`2026-08-03-prompt-fighter-poc.md`](2026-08-03-prompt-fighter-poc.md).

---

## Non-goals (deferred, unchanged from the 2026-08-03 spec's Scope section)

Live model mode, tournament/roster meta, an LLM announcer for flavor text, a larger move
set, and mobile touch controls remain out of scope for this milestone — this plan only
covers turning the single fighter into a real, selectable 4-fighter roster with licensed
character models, not the deferred items from the original POC scope.
