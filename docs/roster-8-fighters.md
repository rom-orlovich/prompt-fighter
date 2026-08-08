# Roster expansion — 4 to 8 fighters (2026-08-08)

The roster grew from 4 fighters (`CLAUDE`, `CODEX`, `GEMINI`, `LOCAL 7B`) to 8, adding
`IRON_FIST`, `VIPER`, `WARDEN`, `BLAZE` — with **zero new 3D assets vendored**. See
[`roster-mesh-acquisition-2026-08-08.md`](./roster-mesh-acquisition-2026-08-08.md) for the
full investigation into why a genuinely new body mesh could not be acquired within this
task's constraints, and the two measured hard gates (payload headroom, skeleton bone-name
overlap) that rule it out under the current 6 MB budget.

## The 8 fighters

| Name | Body | Hair | Tint | Height (arena) | Build (bulk) | Persona |
|---|---|---|---|---|---|---|
| `CLAUDE` | Male | Hair_SimpleParted | `#d97757` | 1.79 × 1.82m ≈ 3.26m | 0.97 | a measured counter-puncher, lean and deliberate |
| `CODEX` | Male | Hair_Beard | `#10a37f` | 1.87 × 1.82m ≈ 3.40m | 1.10 | a bearded front-foot brawler that commits to every swing |
| `GEMINI` | Male | Hair_Buzzed | `#4285f4` | 2.00 × 1.82m ≈ 3.64m | 1.15 | a shaven-headed heavyweight that overwhelms with sheer reach |
| `LOCAL 7B` | Female | Hair_Long | `#a855f7` | 1.66 × 1.78m ≈ 2.95m | 0.90 | a compact featherweight — fast hands, shallow reads |
| `IRON_FIST` | Female | Hair_SimpleParted | `#8c8c9a` | 1.95 × 1.78m ≈ 3.47m | 1.05 | an armored grappler that shrugs off punishment and closes the distance |
| `VIPER` | Female | Hair_Beard | `#76b900` | 1.72 × 1.78m ≈ 3.06m | 0.93 | a venomous counter-striker that waits for one clean opening |
| `WARDEN` | Female | Hair_Buzzed | `#2c3e91` | 2.05 × 1.78m ≈ 3.65m | 1.20 | a stoic wall of a fighter built to absorb and outlast |
| `BLAZE` | Male | Hair_Long | `#ff4500` | 1.95 × 1.82m ≈ 3.55m | 1.08 | a relentless pressure fighter that never lets the pace cool |

`Height (arena)` is `modelScale × the body's natural height` (`Male` = 1.82m, `Female` =
1.78m — see `src/roster/characters.ts`'s `BODY_HEIGHT`/`arenaHeight`), the same value the
camera framing band was measured against.

Each fighter also carries a unique tagline and super-move name (`src/fighters.ts`):

| Name | Tagline | Super |
|---|---|---|
| `IRON_FIST` | unbreakable and slow to anger | ADAMANTINE REBUTTAL |
| `VIPER` | strikes once, strikes true | VENOM INJECTION |
| `WARDEN` | holds the line no matter what | IMMOVABLE VERDICT |
| `BLAZE` | burns through every argument | SCORCHED EARTH |

## Rationale — 2 bodies × 4 hairstyles = 8 unique combinations, zero new assets

The vendored free tier of Quaternius's Universal Base Characters pack ships exactly **2**
rigged body meshes (`Male.glb`, `Female.glb`) and **4** hairstyles rigged to the same shared
skeleton (`Hair_SimpleParted`, `Hair_Beard`, `Hair_Buzzed`, `Hair_Long`), all animated by one
shared clip library (`Anims.glb`) that binds onto every body/hair by bone **name**. That
gives `2 × 4 = 8` distinct body+hair combinations — enough to cover exactly the 4 new
fighters this expansion needed, on top of the 4 already using the first 4 combinations, with
**no hairstyle mesh reused within the same body** and every hairstyle reused exactly twice
total across the full 8-fighter roster (see `tests/roster-expansion.test.ts`'s "reuses each
vendored hairstyle exactly twice" case). Per-fighter identity beyond body+hair comes from
three more independent, asset-free knobs already in the pipeline: a brand skin tint, a
height (`modelScale`), and a build multiplier (`bulk`) — so every one of the 8 fighters is
visually distinguishable (silhouette, color, size, proportions) without a single new triangle
vendored into `public/assets/characters/`.

This was a **deliberate choice, not a limitation worked around silently** — see
`roster-mesh-acquisition-2026-08-08.md` for the four acquisition routes that were checked and
blocked (MakeHuman/Blender not installed; Mixamo needs a login and fails the skeleton
bone-name overlap gate at 0.0 regardless; Sketchfab needs an account-linked API token; more
Quaternius itch.io packs are interactive-download-only) and the two measured hard gates
(payload headroom: only 291,324 B remained under the 6 MB budget, versus ~1.3 MB for a single
already-vendored body; skeleton bone-name overlap: every vendored asset clears ≥0.985 against
the `Male` skeleton's `SKELETON_MATCH_FLOOR = 0.9`). Both gates are now mechanically
re-checkable for any future candidate mesh via `scripts/probe-skeleton-compat.mjs`.

## Before / after test counts

| | Test files | Tests | Failing |
|---|---|---|---|
| Before (baseline, `origin/main` prior to this expansion) | — | 248 | 0 |
| After (this expansion, full `npm test` run) | 27 | 266 | 0 |

`npm run typecheck` is clean and `npm run build` succeeds (see the CI-parity gates re-run for
this task — `.github/workflows/pages.yml` runs the identical `npm ci && npm test && npm run
build` sequence on every push to `main`).

## Screenshots

Roster-preview renders for the 4 new fighters (generated via the roster-preview e2e flow,
`e2e/roster-preview.test.ts`):

- `/tmp/prompt-fighter-roster-preview/IRON_FIST.png`
- `/tmp/prompt-fighter-roster-preview/VIPER.png`
- `/tmp/prompt-fighter-roster-preview/WARDEN.png`
- `/tmp/prompt-fighter-roster-preview/BLAZE.png`

These are ephemeral local verification artifacts under `/tmp` (never committed to the repo);
regenerate them by re-running the roster-preview e2e test.

## Follow-ups (not in scope for this task)

1. **Abilities + special FX for the new four.** `IRON_FIST`, `VIPER`, `WARDEN` and `BLAZE`
   currently have a name, tagline, super-move name and full visual/character spec, but no
   dedicated ability-set or special-move VFX distinct from the original 4 fighters' combat
   behavior — that design + implementation pass is separate follow-on work.
2. **Paid Universal Base Characters tier for genuinely new body meshes.** The clean path to a
   3rd/4th distinct body mesh (rather than reusing `Male`/`Female`) is Quaternius's paid
   "supporter" tier of the same itch.io pack already vendored, reported to include additional
   body variants beyond the free tier. This needs (a) an operator purchase on
   `quaternius.itch.io` — a real-money transaction no worker may authorize itself, and (b) a
   deliberate renegotiation of the 6 MB combined-payload budget in
   `tests/vendored-assets.test.ts`'s `MAX_COMBINED_BYTES`, since Gate A above shows zero
   headroom for even one more ~1.3 MB body under the current budget. See
   `roster-mesh-acquisition-2026-08-08.md`'s "Conclusion" section for the full reasoning.
