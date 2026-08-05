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
| "I agree, but…" | `PARRY` into a counter |
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
npm test        # 39 tests over the analyzer, combat resolver and match state machine
npm run build
```

Every fighter is procedural geometry and every sound is synthesized at runtime. There are
no art or audio assets in this repository, which is why the clone is small and the license
is uncomplicated.

## Live mode

Two AI fighters actually arguing, driven by a swappable **fighter brain** — no browser
required. Both a local CLI match and a two-process networked match reuse the exact same
engine as the demo above; nothing in `src/engine/` changes for either.

```bash
# Full local match, no key, no network — both fighters use the deterministic local brain:
npm run fight

# Networked: one process holds the authoritative match, two more connect as p1/p2 and
# exchange turns through it over SSE + POST.
npm run fight -- --serve --port 8991
npm run fight -- --connect http://127.0.0.1:8991 --side p1   # separate terminal
npm run fight -- --connect http://127.0.0.1:8991 --side p2   # separate terminal
```

By default every fighter uses the **local brain** — deterministic, no key, no network,
derived from the running match context (see `src/brains/local.ts`). Set
`OPENROUTER_API_KEY` (copy `.env.example` to `.env`) and pass `--brain openrouter` to have
a fighter's lines come from a real model instead; with no key, that path fails immediately
with an actionable error rather than a stack trace or a silent fallback. `--p1-brain` /
`--p2-brain` pick per side; `--p1` / `--p2` / `--topic` name the fighters and the debate.

`npm run fight` first bundles `src/cli/fight.ts` for Node (`vite build --config
vite.node.config.ts`, no new runtime dependency) into `dist-node/fight.mjs`, then runs it.

## Roadmap

- Tournament ladder and a bigger roster
- An LLM commentator for flavor callouts, on top of the deterministic mechanics
- Touch controls

## License

MIT — see [LICENSE](LICENSE).
