# Prompt Fighter — Design

**Date:** 2026-08-03
**Status:** Approved, ready for implementation

> Two LLMs walk into an arena. The argument *is* the fight.

## 1. Concept

A 3D arcade fighting game where each fighter is a live AI model session. *(Concept, not current
state: today's fighters are scripted or single-API-call brains — a real agent session driving a
fighter is specified but not built. See §4b.)* The models hold a
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
| Attacks the flaw in the opponent's argument | `UNDERCUT` — strong, but `Pivot` evades it |
| Self-correction ("actually, I was wrong") | credibility loss **but** super meter gain |

> **Implemented 2026-08-06.** The `PARRY` → `COUNTER` row and §3's `Pivot > Undercut` were
> both specified here but absent from `combat.ts`: a `PARRY` fell through every branch and
> resolved as an ordinary hit, and `UNDERCUT` existed only as a *player action*, never as an
> incoming move the resolver could check against — so that leg of the rock-paper-scissors core
> was unreachable rather than merely unimplemented. Both are real now:
> a `PARRY` deflects the opponent's combo and returns as a `counter` event at 1.5× (a super
> `PARRY` stays a super — supers sit above this layer, as they already did for every other
> stance win), and `UNDERCUT` is a `MoveKind` the analyzer produces from unambiguous rebuttal
> phrasing, which `PIVOT` evades outright. Table-driven cases for both live in
> `tests/combat.test.ts` and `tests/analyzer.test.ts`.

The self-correction rule is deliberate: intellectual honesty costs you in the short term and
wins you the round in the long term. It is the most interesting risk/reward in the system.

### Super moves

When the meter fills, a model unleashes a signature move tied to its persona:

| Model | Super |
|---|---|
| Claude | *Constitutional Barrier* (shield + heal) · *Nuance Riposte* (heal) |
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
- Best of 3 rounds, **99**-second round timer (`ROUND_SECONDS` in `main.ts`). This doc said
  "90-second" until 2026-08-06; the code has read 99 since the first playable build, the
  roster spec's own software-rendering note already quoted "its opening `99`", and 99 is the
  arcade convention the whole clock is styled after — so the number here was the stale one,
  not the code. It is also *arcade* seconds, not real ones: `CLOCK_RATE = 0.75` deliberately
  runs the clock slow (a 1.0 clock outran the debate and ended almost every round on a
  decision), so 99 on the HUD is about 132 real seconds.
- Credibility to 0 → `ARGUMENT COLLAPSED` (KO).
- Timer expiry → higher credibility takes the round.

## 4. Architecture

The engine knows nothing about rendering. Every combat rule is a pure function, which is what
makes the mechanics testable without a browser and without calling a model.

```
src/
  engine/          # zero Three.js, zero DOM imports
    types.ts       # Speaker · MoveIntent · CombatEvent · FighterState · MatchState
    analyzer.ts    # analyze(text, ctx) -> MoveIntent          [pure]
    combat.ts      # resolve(intent, action, state) -> CombatEvent[]  [pure]
    match.ts       # FightEngine — rounds, timers, KO, event emission
  sources/
    types.ts       # MatchSource: nextTurn(handlers) · reset() · stop()
                   # (handlers: StreamHandlers — onTurnStart/onTurnChunk/onTurnEnd)
    replay.ts      # bundled transcript, simulated streaming — no key required
    live.ts        # two FighterBrains driving turns through the same MatchSource seam
  brains/          # FighterBrain: local.ts (deterministic, no key) · openrouter.ts (real models) ·
                   # claude-tui.ts (drives a live interactive `claude` TUI session, no key)
  render/          # dumb consumer of CombatEvent
    scene.ts       # Three.js scene, camera, arena, lights
    fighter.ts     # GLTFLoader-loaded CC0 character rig + AnimationMixer pose clips
    fx.ts          # hitstop, screen shake, particles, damage numbers
    hud.ts         # DOM overlay: bars, combo, meter, subtitles, action picker
  cli/             # `npm run fight` — headless local match, or --serve / --connect
  main.ts          # wiring only
server/            # live mode's authoritative match (node:http, SSE + POST /turn).
                   # Node + OpenRouter/claude-tui for real models; the local brain needs neither.
transcripts/       # bundled demo fights (JSON)
```

### Live mode — transport built, real-agent brains not

> **Status correction (2026-08-06).** This section was previously headed *"Live mode
> (implemented)"*. That heading was accurate about the **transport** (the server, the
> `--connect` HTTP/SSE API, the CLI) and about the two **scripted / API brains** shipped
> behind it — and inaccurate about what "two live AI models fighting" (§1) was supposed to
> mean. A `FighterBrain` that runs a canned local script, or that makes one HTTP call to a
> completions endpoint, is not a real model *session* playing the game. Splitting the two
> halves apart below, so the built part and the missing part stop being read as one thing.

#### (a) Built today — scripted / API brains (CURRENT STATE)

Two deliverables sit behind the `MatchSource`/`FighterBrain` seams above, both reusing
`engine/` unchanged: `npm run fight` (a full local match in a terminal, driven by
`sources/live.ts` in-process) and `npm run fight -- --serve` / `--connect` (a `server/`
process holding the one authoritative `FightEngine`, with two remote client processes
submitting turns over SSE + POST — see `tests/live-mode-parity.test.ts` for the proof
that neither path ever resolves a turn differently than calling the engine directly).
`FighterBrain` is the one seam that decides what a fighter "says": `brains/local.ts` is
deterministic and needs no key, so both deliverables run with zero setup;
`brains/openrouter.ts` calls a real model when `OPENROUTER_API_KEY` is set and fails
with an actionable error, never a stack trace, when it isn't. The CLI's turn loop
(`cli/runner.ts`) reuses `simulate.ts`'s own two-tier termination strategy — a generous
turn cap, then a timeout-guard loop that forces round decisions by credibility — so a
live match can never spin forever. See the README's "Live mode" section for usage.

**Update (2026-08-06) — a third consumer: the browser UI itself.** The CLI and the
server were the only two things driving `sources/live.ts` when this section was
written; the website's own game UI (`src/main.ts`) now has a third, no-setup entry
point. A **LIVE MODE** button on the character-select screen (`index.html`,
`#live-mode-btn`) calls `createLiveSource()` with two `local` brains directly in the
browser — no server, no SSE, no round trip — and feeds the result into the exact same
`beginMatch()`/`runLoop()` pipeline the scripted-transcript demo already uses, so a
live match gets the identical renderer, HUD and round/KO handling for free. This
button never offers the `openrouter` brain: `OPENROUTER_API_KEY` is a server-side
secret read from `process.env` in the CLI/server's Node process, and a browser bundle
shipped to every visitor is never a safe place to hold or forward it — the same
constraint the CLI's own `--brain openrouter` default already respects (`local`
unless a caller opts in). Because both fighters use the deterministic local brain,
this needs no `.env`, no key, and no network call, so it demos exactly as-is on a
fresh clone.

Both shipped brains are **scripted or single-call**: `local.ts` decides its message from a
deterministic table, and `openrouter.ts` sends one completions request per turn. Neither is a
live agent *session* — nothing on either side is reasoning about the argument across turns the
way a real coding-agent session would. This is the current state, and it is the part that is
done.

#### (b) NOT YET IMPLEMENTED — real-agent brains

The intended end state, and the thing "live mode" was for: **a real Claude Code / Codex /
Gemini CLI session — an actual running coding-agent window, reasoning and writing — is p1 or
p2.** It joins a match through the same `--connect` API that already exists, reads the match
state, decides what to argue on the merits of the topic, and submits that as its move. No
canned script, no one-shot completion call: the fighter *is* the agent session.

Nothing about the transport needs to change for this. The pieces below already exist and are
reusable as-is (`src/server/http.ts`, `src/server/session.ts`, `src/server/client.ts`):

| Endpoint | Purpose |
|---|---|
| `GET /state` | Full snapshot — topic, names, `nextSpeaker`, credibility, round, full turn + event history. Enough to join late and reconstruct the whole fight. |
| `GET /stream` | SSE broadcast — one message per resolved turn, so a joined side knows when it is on. |
| `POST /turn` `{ speaker, text }` | Submit this side's message. The server holds the one authoritative `FightEngine`; an out-of-order or post-KO turn is rejected (`409`) rather than mis-resolved. |

What is **missing** is only the connector between an agent session and those endpoints — one of:

- a small CLI wrapper (`--connect --agent`, or a sibling command) that hands the live match
  state to an agent session and posts back whatever it writes; **or**
- a documented plain-HTTP protocol — short enough to paste into a Claude Code / Codex session
  as its instructions — telling it how to poll `/state`, watch `/stream`, and `POST /turn`,
  with no wrapper at all.

Either satisfies the requirement; the second is cheaper and needs no new code, only docs. Both
are **planned, not built.** `FighterBrain` (`nextMessage(ctx) -> Promise<string>`) is already
the correct seam for the wrapper form — an agent-backed brain is a third implementation of an
interface the engine, source contract and renderer are all already blind to.

#### (c) Window-vs-window — local *and* remote (explicit requirement)

> **Scope correction (2026-08-06).** This section previously read *"No cloud, no hosted
> matchmaking — the loopback case is the primary case, not a fallback"*, i.e. local-only.
> That was wrong. Both cases are required.

Each real agent session drives the fighter it picked through the CLI, and **both of these are
in scope**:

- **Local (same machine, two windows).** Two agent sessions in two separate terminal windows
  on one machine, both `--connect`ed to a `--serve` process on `127.0.0.1`. This stays the
  simplest, zero-network-setup case — nothing to configure, nothing to expose — and it is the
  one to make work first.
- **Remote (against a friend, over the network).** Two agent sessions on *different* machines,
  both `--connect`ed to one `--serve` process reachable at a real address. Same command, same
  API, just `--connect http://<host>:<port>` instead of `http://127.0.0.1:<port>`.

Remote is not a second transport and needs no new capability: nothing about `GET /state`,
`GET /stream` or `POST /turn` is loopback-specific. `--connect` already takes a full base URL
(`fight.ts` documents `--connect http://host:port`), and `--serve` already calls
`server.listen(port)` with no host argument, so it binds every interface rather than loopback
only — the only loopback-flavoured thing in the code today is the `127.0.0.1` hint the serve
command prints. Remote play is the same server and client code at a different address.

Structurally the two-process shape already works: two separate `--connect` client *processes*
playing one server-held match to completion is exactly what ships today and what
`tests/live-mode-parity.test.ts` proves resolves identically to calling the engine directly.
The gap is still (b) — today both processes are driven by a scripted brain, so the plumbing
for "two windows, one fight" is proven while neither side is yet a real reasoning agent.

**Open items for the remote case** (not solved here — flagged honestly, not designed):

- ~~**No authentication on the connect API.**~~ **Addressed 2026-08-06 (minimally).** This was
  not merely theoretical: a review reproduced it on a live server, impersonating *both* p1 and
  p2 through unauthenticated `POST /turn`. `--serve` now mints a random per-run **match token**
  and prints the connect URL with it embedded, so joining stays one copy-paste; every route
  (`/state`, `/stream`, `/turn`) rejects a missing or wrong token with `401`, accepting it as
  `?token=` or `Authorization: Bearer`. There is no code path that starts an unauthenticated
  server — a token is generated when the caller doesn't pin one. This is deliberately the
  smallest thing that stops an unexpected *caller*: no accounts, no persistence, no expiry, and
  it dies with the process. It does **not** make the port safe to expose publicly, because the
  next gap is unchanged:
- **No TLS.** `--connect` is plain HTTP, so a remote match's traffic — now including the match
  token — is unencrypted in transit. This is the reason the token above raises the bar for a
  friend match on a trusted network without making public exposure acceptable.
- **Reachability is unspecified.** Exposing `--serve` to a friend means a public address, port
  forwarding, or a tunnel/VPN; the spec picks none of these and the CLI helps with none of them.

These need answering before remote play is offered to anyone beyond a trusted LAN — they are
listed as known gaps, not as a design.

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
unarmed-combat clip set of 15 shared pose clips (idle and guard stances, jab, cross, hook,
hit reactions, a slide, a jump and a K.O.), trimmed and merged from two CC0 animation
libraries (G17/G20a — see the roster spec). All four fighters share one rig. The body's own skin/costume texture is what the mesh reads as (G23 —
see below); brand identity comes from a fresnel rim glow, a ground glow, a recoloured
trunks/briefs accent baked into that same texture, and per-fighter hair/height/build, not from
painting the whole body a flat brand hue.

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

Game feel is carried by: 90ms hitstop on impact (300ms on a super), screen shake, camera
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

**Skin realism (G23).** G15 restored the body's normal/roughness maps but kept the base-colour
(skin/costume) texture stripped, so the fighters had real surface *relief* under real shading
detail but were still painted a single flat brand hue underneath it — real muscle striations,
unreal colour. That trade made sense before G21: with no other identity carrier, whole-body
brand paint was the only thing telling four fighters apart, and three of them (CLAUDE, CODEX,
GEMINI) share the same `Male` body. G21 changed the economics by adding identity that doesn't
depend on whole-body paint — the rim glow, the ground glow, and the HUD/select-card brand colour
(nameplate, health bar, card border, all keyed to `ROSTER[name].color`, independent of the 3D
model). That made it affordable to reopen the G15 trade:

- `scripts/vendor-characters.mjs`'s `packBodyGlb` now also keeps the body's base-colour map
  (downscaled to 256px — narrower than the 512px normal/roughness maps, since a photographic
  skin texture compresses far worse than the smoother normal/roughness maps at the same
  resolution, and the restored maps had to fit the existing ~370KB of headroom under the 6MB
  vendored-asset budget).
- `fighter.ts`'s `tint()` no longer overwrites `material.color` for a mesh that actually has this
  texture (`hasMap`) — the loaded base colour is left alone, so the body reads as its own real
  skin/costume tone rather than a brand-tinted flat colour. Hair, eyebrows and eyes never got a
  base-colour map restored, so they keep the exact pre-G23 flat-tint behaviour untouched.
- The constant ambient emissive on the skin-textured material dropped from `0.3` to `0.04`
  (`SKIN_BASE_EMISSIVE_INTENSITY`) — a resting brand-coloured glow that strong would still read
  as a lit paint job on top of the now-visible texture. Charge/flash still add their existing
  magnitudes on top, so hit feedback is if anything more legible: it now ramps up from a near-dark
  baseline instead of an already-lit one.
- The vendored base-colour texture happens to bake in a distinct, near-neutral dark region for
  the costume's trunks/briefs (sampled directly from the shipped texture's reduced colour
  palette, not guessed — see `SKIN_ACCENT_LUM_THRESHOLD`'s doc comment in `fighter.ts`).
  `attachRimShader` gained an optional shader injection, right after `#include <map_fragment>`,
  that recolours any texel below both a luminance and a saturation threshold to the fighter's
  full brand hue. That reads as a real costume accent — trunks in the fighter's own colour — not
  a paint job, and gives same-body fighters one more instantly-legible brand-coloured shape
  beyond hair and build.

Verified by rendering: a real-GPU before/after (git-stash technique, as G21 used) on the same
fighter in the arena and on a select card shows visible muscle definition, skin-tone shading and
non-uniform specular where the "before" frame was a flat, uniformly-lit single-hue silhouette —
in the arena mid-fight, e.g., CODEX's back and shoulders show real form and a visible beard,
where before it was a uniform neon-green mannequin. On the select grid, all four fighters remain
instantly tellable apart: three share a body but differ by hairstyle, build and a clearly
brand-coloured trunks accent (most visible on CODEX's mint-green and GEMINI's bright blue against
their cooler key-light tint; present but subtler on CLAUDE, whose warm key light sits closer in
hue to its own brand orange).

**What was verified, and where (corrected 2026-08-06).** This paragraph previously claimed
"124 unit tests, tsc, build and the full e2e suite (18/18 headed, real GPU, `--workers=2`) all
green" as one flat fact. Two halves of that need separating, because they are not verifiable in
the same place:

- **The rendering claims above (G21/G23) were genuinely observed**, on a real-GPU dev machine,
  by the before/after git-stash screenshot technique each section describes. Nothing here
  retracts them — they are just not re-checkable on a host without a GPU.
- **"18/18" is not reproducible on a GPU-less host, and was never the whole suite passing.**
  The e2e suite has since grown to 24 specs (18 at the time that claim was written), 5 of
  which deliberately self-skip when they detect a software rasteriser
  (`swiftshader|llvmpipe|software|none`) rather than assert something weaker — see the roster
  spec's "Recording the demo needs a real GPU". A real `npx playwright test --workers=2` on a
  software rasteriser is therefore **19 passed / 5 skipped / 0 failed**, verified repeatedly
  on 2026-08-07. `--headed` *does* launch here (there is an X server) but changes nothing: the
  rasteriser is still software, so the same 5 specs still skip. "24/24" would require a real
  GPU, where those 5 stop skipping and actually run.
- Unit tests, `tsc --noEmit` and both builds are host-independent and green: **237 vitest tests**
  as of 2026-08-07 (124 was the count when this line was first written, 186 as of
  2026-08-06; the suite has kept growing, including the `claude-tui` brain's marker-protocol
  and factory-wiring coverage).

### Open gap — it does not yet feel like a real fighting game (unmet, 2026-08-06)

Everything in §5 above describes work that shipped and was verified by rendering. None of it
closes this gap, and this section exists so the spec stops implying otherwise.

The operator's assessment of the current build, in his own terms: the characters must perform
**real, realistic movement**; there must be **real graphics and real combos**; and the whole
thing has to **feel like an actual Tekken game** — which it does not today. That is the bar.
It is a judgment about the fight's overall presentation and feel, not a list of defects, and it
is **not met.**

One factual note that helps scope it later, drawn from §5 itself rather than added as a theory:
the shipped animation vocabulary is 15 pose clips — idle and guard stances, jab, cross, hook,
hit reactions, a slide, a jump and a K.O. — all shared across one rig (expanded from the
original six by G17/G20a). The engine's move set (`JAB` · `HEAVY` · `PARRY` →
`COUNTER` · `CRIT` · `GUARD` · `GRAPPLE` · supers, plus a combo counter, §2) is still richer
than the animation set that has to express it, but a combo now reads as a sequence of distinct
strikes advancing by chain position (G18), not merely as a number on the HUD. That is a
description of the current state, not a prescribed fix.

**No solution is proposed here, deliberately.** This is a large, subjective, visual undertaking
— animation vocabulary, movement/spacing, hit reactions, camera, and what "real graphics" should
mean for this project are all open questions with very different costs. It needs its own
dedicated scoping pass first, and — following how G21 and G23 were actually settled — that pass
should produce **rendered preview/comparison work to look at and choose from before anything is
committed to**, not a plan written blind. Treat this as an open item awaiting that scoping, not
as a task ready to pick up.

## 6. Testing

`vitest` over `engine/`. The analyzer and combat resolver are pure functions with table-driven
cases: a given message text and context must produce a specific `MoveIntent`, and a given
intent + player action must produce specific `CombatEvent`s. Rendering is verified by running
the game, not by unit tests.

## 7. Repository

Public, MIT licensed, English code and docs. Vite + TypeScript + Three.js. GitHub Actions
deploys to Pages so the demo is playable from a link with no install. `.env.example` only —
no keys committed. Live mode is **on by default for the CLI**: `npm run fight` always
drives two `FighterBrain`s through `sources/live.ts` (the local brain unless `--brain
openrouter` or `--brain claude-tui` is passed) — there is no replay/demo path in the CLI to
opt out of. The **browser** is the opposite: it defaults to the bundled replay transcript,
and live mode there is opt-in, behind the character-select screen's **LIVE MODE** button.

## 8. Scope

**In the POC:** 3D arena and two animated fighters · replay source with demo transcripts ·
analyzer, combat resolver and their tests · full HUD · timed player action window · hitstop,
shake and particles · rounds and KO flow · README · public repo · **live mode transport** — a
headless CLI match and a two-process networked match, both driven by a swappable
local/OpenRouter `FighterBrain`, both reusing the POC's own engine unchanged (see §4a).

**Open — required, not yet built** (these are the gap between what ships and what the game is
supposed to be, not "nice to have"):

- **Real-agent brains** — a live Claude Code / Codex / Gemini session driving a fighter through
  the existing `--connect` API, including two such sessions in two terminal windows on one
  machine fighting over `localhost`. Transport exists; the connector/protocol does not. See §4b
  and §4c.
- **Fighting-game feel** — realistic movement, real graphics and real combos, at a "real Tekken
  game" bar. Unmet, and awaiting its own scoping pass with rendered previews before any
  implementation. See §5's open-gap section.

**Deferred:** tournament and roster meta · LLM announcer for flavor text · larger move set ·
mobile touch controls.
