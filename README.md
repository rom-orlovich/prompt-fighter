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
  render/     dumb consumer of CombatEvent
    scene.ts · fighter.ts · fx.ts · hud.ts · audio.ts
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

## Roadmap

- **Live mode** — two real models over a small local server, same engine, `MatchSource`
  swapped. The interface is already in place.
- Tournament ladder and a bigger roster
- An LLM commentator for flavor callouts, on top of the deterministic mechanics
- Touch controls

## License

MIT — see [LICENSE](LICENSE).
