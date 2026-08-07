# PROMPT FIGHTER

> Two LLMs walk into an arena. The argument **is** the fight.

A 3D arcade fighting game where each fighter is an AI model session. The models hold a
debate, and every message one of them sends *is a move* — its length, confidence, evidence
and willingness to concede decide which attack lands, how hard, and whether it can be
countered.

You are not a fighter. You are the corner coach: while the other model is typing, you pick
the stance your model answers with.

![Prompt Fighter](docs/screenshot.png)

## Play

```bash
npm install
npm run dev
```

No API key, no account, no backend. The demo ships with recorded debates and plays instantly.

## How a conversation becomes a fight

| What the model does | What happens on screen |
|---|---|
| Short, sharp reply | `JAB` — fast, low damage, safe |
| Long detailed reply | `HEAVY` — big damage, long recovery, **punishable** |
| "I agree, but…" | `PARRY` — kills their momentum and comes back as a counter |
| Goes after the flaw in their argument | `UNDERCUT` — strong, unless they `Pivot` |
| Cites evidence (a stat, a code block, a link) | `CRITICAL` — double damage |
| Hedges ("maybe", "it depends", "not sure") | `GUARD` — chip damage only |
| Ends on a question | `GRAPPLE` — forces a reply, opens a combo |
| Stays on the same argument | combo counter climbs |
| Changes the subject | combo breaker |
| Repeats itself | self-damage — you are arguing with yourself |
| Concedes the point | straight credibility loss |
| Corrects itself honestly | credibility loss **and** a big super-meter gain |

Health is **credibility**. Run out and your argument collapses.

That last row is the rule the whole design hangs on: admitting you were wrong costs you the
exchange and wins you the round.

## Your four stances

Pick one while the opponent is still typing. It sets your defense *and* becomes the
instruction your own model writes its next message under.

| Stance | Mechanic |
|---|---|
| **Fact Strike** | High crit. Punishes a hedging opponent outright. |
| **Undercut** | Counter. Devastating against a long `HEAVY` answer, weak against anything else. |
| **Pivot** | Evade and break their combo, at reduced damage. Beats Undercut. |
| **Guard** | Cut incoming damage, build super meter. Wins nothing on its own. |

Miss the window and you eat the hit at 125%.

Because a streaming reply *is* the wind-up animation, model latency is the game's clock:
the longer they type, the heavier the incoming attack, and the longer you have to read it.

## Architecture

```
src/
  engine/     pure combat core — no Three.js, no DOM, fully unit tested
    analyzer.ts   text → MoveIntent      (the mapping table above)
    combat.ts     intent + stance → CombatEvent[]
    match.ts      rounds, KO, best-of-three
  sources/    where turns come from
    replay.ts     bundled transcripts, simulated streaming (no key needed)
    live.ts       two FighterBrains driving turns (local, or real models over OpenRouter)
  render/     dumb consumer of CombatEvent
    scene.ts · fighter.ts · fx.ts · hud.ts · audio.ts
  brains/     FighterBrain — local (no key) and OpenRouter (real models) implementations
  cli/        `npm run fight` — a full headless match in a terminal, no browser
server/       node:http — the authoritative match for two remote clients (SSE + POST /turn)
```

The engine cannot see the screen and the renderer cannot see the rules. Swapping the
recorded transcript for live models means implementing one interface — `MatchSource` —
and changing nothing else.

```bash
npm test        # 240 tests over the analyzer, combat resolver, match state machine,
                # brains, roster data and the live-mode server
npm run build
```

There is also an end-to-end suite (`npm run test:e2e`) that drives the real game in a
browser. Five of its twenty-three specs need a real GPU and deliberately skip themselves under
a software rasteriser rather than assert something weaker, so a run on a GPU-less machine
reports 18 passed / 5 skipped. Those 18 are timing-sensitive against a software rasteriser,
which is why `playwright.config.ts` caps workers and allows one retry — see the comment
there for the measurements behind those two settings.

Every sound is synthesized at runtime, and the arena, HUD and effects are all Three.js
primitives and DOM — no audio files, no particle library, no post-processing stack. The
fighters themselves are **real CC0 low-poly character models** (`public/assets/characters/`,
loaded with `GLTFLoader` and animated with `AnimationMixer`); they were procedural geometry
early on, and this line said so for a while after that stopped being true. The asset policy
is scoped rather than asset-free: CC0 only, nothing proprietary or attribution-required,
which is what keeps the clone small and the license uncomplicated.

## Live mode

Two AI fighters actually arguing, driven by a swappable **fighter brain**. Three ways to
watch one play out — in the browser, from a terminal, or networked across two terminals —
and all three reuse the exact same engine as the demo above; nothing in `src/engine/`
changes for any of them.

### In the browser (no install beyond `npm run dev`)

Click **LIVE MODE** on the character-select screen. Two fighters, both driven by the
deterministic local brain (see below), play out automatically in the arena you're already
looking at — same renderer, same HUD, same round/KO rules as a scripted demo fight, just
with the turns generated live instead of replayed from a transcript. No server, no API
key, no `.env` — it works the moment the page loads. This is a client-side-only match:
the browser bundle never holds `OPENROUTER_API_KEY` (that stays server/CLI-side only), so
the in-browser button always uses the local brain, the same "no key configured" behavior
`npm run fight` falls back to below.

### From a terminal

```bash
# Full local match, no key, no network — both fighters use the deterministic local brain:
npm run fight

# Networked: one process holds the authoritative match, two more connect as p1/p2 and
# exchange turns through it over SSE + POST.
npm run fight -- --serve --port 8991
```

`--serve` prints the two client commands with a per-run **match token** already embedded —
copy them as-is:

```bash
npm run fight -- --connect "http://127.0.0.1:8991?token=<printed>" --side p1   # separate terminal
npm run fight -- --connect "http://127.0.0.1:8991?token=<printed>" --side p2   # separate terminal
```

The token is generated fresh on every `--serve` and required by `/state`, `/stream` and
`/turn` alike (as `?token=` or `Authorization: Bearer`); without it the server answers `401`,
so a stranger who can reach the port cannot read the match or submit turns as either side.
`--token` pins or overrides it. Keep the URL quoted — `?` is a shell glob character. Traffic
is still plain HTTP, so this is meant for a match with a friend on a network you trust, not
for exposing the port publicly. A purely local match (`npm run fight` with no `--serve`) has
no server, no network and no token — it is unchanged.

By default every fighter uses the **local brain** — deterministic, no key, no network,
derived from the running match context (see `src/brains/local.ts`). Export
`OPENROUTER_API_KEY` in your shell (`.env.example` documents the variable, but nothing in
this codebase loads a `.env` file — no `dotenv` or equivalent is wired in anywhere, so
copying it to `.env` alone does nothing; the process reading `process.env.OPENROUTER_API_KEY`
needs it actually exported) and pass `--brain openrouter` to have a fighter's lines come from
a real model instead; with no key, that path fails immediately with an actionable error
rather than a stack trace or a silent fallback. `--p1-brain` /
`--p2-brain` pick per side; `--p1` / `--p2` / `--topic` name the fighters and the debate.
(The browser button above never exposes this flag — see "In the browser" note.)

`npm run fight` first bundles `src/cli/fight.ts` for Node (`vite build --config
vite.node.config.ts`, no new runtime dependency) into `dist-node/fight.mjs`, then runs it.

## Roadmap

- Tournament ladder and a bigger roster
- An LLM commentator for flavor callouts, on top of the deterministic mechanics
- Touch controls

## License

MIT — see [LICENSE](LICENSE).
