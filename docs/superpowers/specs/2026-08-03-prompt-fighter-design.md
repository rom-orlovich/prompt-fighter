# Prompt Fighter — Design

**Date:** 2026-08-03
**Status:** Approved, ready for implementation

> Two LLMs walk into an arena. The argument *is* the fight.

## 1. Concept

A 3D arcade fighting game where each fighter is a live AI model session. The models hold a
conversation (a debate on a topic), and every message one of them sends **is a move**. The
rhetorical properties of the message — its length, confidence, evidence, whether it concedes
or pivots — determine which attack is thrown, how much damage it deals, and whether it can be
countered.

The player is not a fighter. The player is a **corner coach / prompt puppeteer**: while the
opponent model is streaming its reply, the player picks the *strategy* their own model will
use next. That choice both modifies defense this turn and becomes the instruction the model
writes its next message under.

Health is **credibility**. You lose it by being contradicted, caught hedging, or conceding.

### Why this framing

Two properties fall out of it for free:

- **Model latency becomes a mechanic.** A streaming reply is a visible wind-up animation. A
  long reply is a heavy, slow, punishable attack. Waiting for the API stops being dead time and
  becomes tension.
- **The game is legible without reading.** A viewer who never reads the subtitle strip still
  sees who is winning, because rhetoric maps onto readable fighting-game verbs.

## 2. Combat mapping

The core translation table from conversation to combat:

| Conversational behavior | Move |
|---|---|
| Short, sharp reply | `JAB` — fast, low damage, safe |
| Long detailed reply | `HEAVY` — high damage, long recovery, punishable |
| "I agree, but…" | `PARRY` → `COUNTER` |
| Concrete evidence (code block, number, citation, URL) | `CRIT` — 2× damage |
| Hedging ("maybe", "it depends", "I'm not sure") | `GUARD` — chip damage only, loses meter |
| Ends with a question | `GRAPPLE` — forces a reply, opens a combo |
| Continues the same argument thread | combo counter increments |
| Changes the subject | combo breaker |
| Repeats itself / loops | `SELF_HIT` — confusion, self-damage |
| Full agreement / concession | credibility loss |
| Self-correction ("actually, I was wrong") | credibility loss **but** super meter gain |

The self-correction rule is deliberate: intellectual honesty costs you in the short term and
wins you the round in the long term. It is the most interesting risk/reward in the system.

### Super moves

When the meter fills, a model unleashes a signature move tied to its persona:

| Model | Super |
|---|---|
| Claude | *Constitutional Barrier* (shield) · *"Actually, Let Me Reconsider"* (heal + counter) |
| GPT / Codex | *Confident Fabrication* — huge damage, catastrophic whiff if unsupported |
| Gemini | *Context Window Slam* — wide-area attack |
| Local 7B | *Fast Inference* — flurry of quick, shallow jabs |

## 3. Player actions

Chosen during the opponent's stream, under a countdown. Each is both a defensive stance and
the instruction the player's model writes under next turn.

| Action | Mechanic | Instruction to the model |
|---|---|---|
| **Fact Strike** | High crit, slow. Beats `GUARD`. | "Answer with concrete evidence." |
| **Undercut** | Counter. Devastating against `HEAVY`, weak otherwise. | "Find the flaw in their argument." |
| **Pivot** | Evade, breaks their combo, reduced damage. Beats `Undercut`. | "Change the framing." |
| **Guard** | Damage reduction + meter gain. Wins nothing on its own. | "Concede minor points, hold the core claim." |

No selection before the timer expires → default stance, and the player eats the hit.

Rock-paper-scissors core: `Undercut` > `HEAVY`, `Fact Strike` > `Guard`, `Pivot` > `Undercut`,
`Guard` = universal mitigation with no win condition.

### Match structure

- Credibility: 100 per fighter.
- Best of 3 rounds, 90-second round timer.
- Credibility to 0 → `ARGUMENT COLLAPSED` (KO).
- Timer expiry → higher credibility takes the round.

## 4. Architecture

The engine knows nothing about rendering. Every combat rule is a pure function, which is what
makes the mechanics testable without a browser and without calling a model.

```
src/
  engine/          # zero Three.js, zero DOM imports
    types.ts       # Turn · MoveIntent · CombatEvent · FighterState · MatchState
    analyzer.ts    # analyze(text, ctx) -> MoveIntent          [pure]
    combat.ts      # resolve(intent, action, state) -> CombatEvent[]  [pure]
    match.ts       # FightEngine — rounds, timers, KO, event emission
  sources/
    types.ts       # MatchSource: start() · onTurnStart · onTurnChunk · onTurnEnd
    replay.ts      # bundled transcript, simulated streaming — no key required
    live.ts        # SSE from the local server — real models
  render/          # dumb consumer of CombatEvent
    scene.ts       # Three.js scene, camera, arena, lights
    fighter.ts     # procedural low-poly rig + keyframe pose animation
    fx.ts          # hitstop, screen shake, particles, damage numbers
    hud.ts         # DOM overlay: bars, combo, meter, subtitles, action picker
  main.ts          # wiring only
server/            # optional live mode (Node + OpenRouter). Not needed for the demo.
transcripts/       # bundled demo fights (JSON)
```

### Turn data flow

1. `MatchSource` emits `turn:start { speaker }`.
2. `turn:chunk { text }` repeatedly while the reply streams. Renderer plays a wind-up whose
   charge level scales with tokens received. HUD opens the player action window with a timer.
3. `turn:end { fullText }` → `analyzer.analyze()` → `MoveIntent`.
4. `combat.resolve(intent, playerAction, state)` → `CombatEvent[]`.
5. Renderer animates the events; engine updates state; HUD updates.

Both sources implement one interface, so the renderer and engine cannot tell replay from live.
This is what lets the public demo run with no API key while the same build supports real models.

### Analyzer signals

Extracted per message: token length · hedge-marker count · assertive-marker count · evidence
presence (fenced code, numerals with units, quotation, URL) · agreement vs. "agree-but" ·
trailing question mark · token overlap with the opponent's previous turn (topic shift) ·
similarity to the speaker's own previous turn (looping) · self-correction markers.

## 5. Visual design

Dark void, neon grid floor with reflection, volumetric spotlights, Tekken-style 3/4 side camera.

Each fighter is a **real CC0 low-poly humanoid model** with realistic (~7-head) proportions,
loaded via `GLTFLoader` and animated at runtime with `AnimationMixer` against a genuine
unarmed-combat clip set: guard-up stance, jab, cross, two hit reactions and a K.O. All four
fighters share one rig; brand color is applied by material tinting on the base mesh — cloned
per fighter and recolored to its brand hue with an emissive rim — rather than by swapping
geometry, and per-fighter height and build keep the silhouettes apart.

**Streaming text (revised, G13).** The original design floated a canvas-textured,
camera-facing billboard above the humanoid rig's head, streaming the model's reply with a
blinking cursor — descended from an even earlier design where the billboard *was* the
fighter's head. Once the arena spacing tightened enough for fighters to actually trade blows
(see §2), that billboard started sitting on top of the fighters' own heads and, mid-exchange,
overlapping the opponent's billboard in the middle of the screen — and it was showing nothing
the HUD's own subtitle strip (`hud.ts`, driven by the same `onTurnChunk` stream) wasn't already
rendering larger and more legibly at the same moment. It was removed outright rather than
relocated: the subtitle strip is now the one place the streaming reply appears, and the
character-select card's own name label absorbed the billboard's other job of identifying the
fighter. `src/render/fighter.ts` no longer creates a sprite of any kind.

Asset policy is scoped, not asset-free: CC0-licensed low-poly humanoid assets are permitted
for fighter models; no proprietary or attribution-required assets. This keeps the public repo
free of any licensing question while allowing real character models instead of a fully
procedural rig.

Game feel is carried by: 80ms hitstop on impact (260ms on a super), screen shake, camera
zoom-punch, spark bursts, an additive trail streaked along the striking fist, per-super
themed particle-and-ring effects, floating damage numbers, Tekken-style angled health bars
with a white chip-damage bar that lags behind, combo counter with a scale pop, and announcer
callouts (`ROUND 1 — FIGHT!`, `COUNTER!`, `CRITICAL — CITED SOURCE!`, `K.O.`). All of it is
Three.js primitives and DOM — no post-processing stack, no particle library. Sound is
synthesized in WebAudio — no audio files.

**Aggressive stance and reactive energy (G21).** A critic pass on the shipped roster (G15-G20)
found the fighters mechanically rich but visually inert: `Sword_Idle` is a wide, upright,
essentially neutral combat stance with no forward lean anywhere on the rig, the brand-tint
emissive glow was a flat constant (`BASE_EMISSIVE_INTENSITY`) modulated only by per-turn charge
and hit-flash — nothing read as coiled power — and the arena's lighting was static: one ambient,
two brand-coloured spots, one fixed rim, none of it reactive to fight state. Three changes,
purely presentational (`src/render/fighter.ts`, `src/render/scene.ts`, `src/main.ts` —
`src/engine/` untouched):

- **Posture.** Each fighter carries a static ~3.4° forward lean toward its opponent
  (`group.rotation.z`, pivoting at the rig's own feet rather than through the yaw already on
  `model.rotation.y`), so a waiting fighter looms instead of standing square. A further ~2°
  layers on top as the fighter's own "aggression" (below) builds, so a fighter visibly loads
  forward the more dangerous it reads — combined max ~5.4°, tuned by rendering and looking:
  enough to read as weight-forward intent, nowhere near enough to look like toppling.
- **Reactive "coiled power."** `FighterRig.setAggression(value)` is a new 0-1 signal, eased over
  ~0.35s rather than snapping, fed from `Math.max(meterFraction, streakFraction)` in `main.ts` —
  a fighter reads as dangerous either on a full super meter or deep in a combo streak, whichever
  is higher, and it decays back down as both cool off. It drives two things at once: a
  fresnel-style rim glow along the silhouette edge, injected into the brand-tinted body
  materials' compiled shader via `onBeforeCompile` (three.js has no built-in fresnel term, and a
  full outline-shell duplicate mesh was rejected as too expensive to repeat across six live
  skinned rigs — two in-arena plus four select-screen previews); and a soft additive ground glow
  underfoot that brightens from a faint scorch at rest to a visible pool of light at full
  meter/combo. Both are added at grazing viewing angles / underfoot only, after the
  normal/roughness-lit surface shading is already resolved — the face-on musculature G15
  restored is untouched; only the edge and the floor pick up the extra light.
- **Lighting.** The two key spotlights narrowed (36°→30° cone, tighter penumbra) and brightened
  slightly, and the rim directional light strengthened (1.6→2.0) — a more raking, better-defined
  key light is what actually makes the normal/roughness maps read as musculature instead of a
  soft even wash, and a stronger backlight separates the silhouette from the dark background
  hard enough for the new rim glow to read as an edge on something already lit, not a glow
  floating in void.

Verified by rendering: the select-screen preview camera re-solves from each rig's own measured
bounds every load (see §4 below), so the added lean doesn't reintroduce the G16 head-cropping
bug — confirmed by screenshot, no head clipped, all four cards still fill at a consistent size.
A same-fighter close-up before/after confirms the rim/ground-glow treatment does not wash out
the G15 surface detail. `window.__pf.rigs[side].aggression` exposes the live eased value; an
undriven real match shows it swing from ~0 (round open) to ~0.9+ (a deep streak or full meter)
and back down, not a constant (`e2e/fight-feel.test.ts`).

## 6. Testing

`vitest` over `engine/`. The analyzer and combat resolver are pure functions with table-driven
cases: a given message text and context must produce a specific `MoveIntent`, and a given
intent + player action must produce specific `CombatEvent`s. Rendering is verified by running
the game, not by unit tests.

## 7. Repository

Public, MIT licensed, English code and docs. Vite + TypeScript + Three.js. GitHub Actions
deploys to Pages so the demo is playable from a link with no install. `.env.example` only —
no keys committed, and live mode is opt-in.

## 8. Scope

**In the POC:** 3D arena and two animated fighters · replay source with demo transcripts ·
analyzer, combat resolver and their tests · full HUD · timed player action window · hitstop,
shake and particles · rounds and KO flow · README · public repo.

**Deferred:** live model mode · tournament and roster meta · LLM announcer for flavor text ·
larger move set · mobile touch controls.
