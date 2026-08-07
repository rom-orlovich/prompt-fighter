#!/usr/bin/env node
/**
 * `npm run fight` — the CLI driver for both live-mode deliverables:
 *
 *   npm run fight                                          local full match, no args
 *   npm run fight -- --serve [--port N]                    starts the authoritative server
 *   npm run fight -- --connect "http://host:port?token=T" --side p1   a client for one side
 *
 * `--serve` mints a per-run match token and prints the connect URL with it already
 * embedded, so joining stays one copy-paste; `--token` pins or overrides it. A local
 * match (the first form) is unchanged — no server, no network, no token.
 *
 * All three reuse the same engine, brains and formatting — this file is wiring only.
 */

import { parseArgs } from 'node:util';
import { FightEngine } from '../engine/match';
import type { Speaker } from '../engine/types';
import { createBrain, type BrainKind } from '../brains/index';
import { hasDispose } from '../brains/claude-tui';
import type { FighterBrain } from '../brains/types';
import { createLiveSource } from '../sources/live';
import { runLiveMatch } from './runner';
import { formatCredibility, formatEvent, formatTurnHeader, type Names } from './format';
import { startServer } from '../server/http';
import { runRemoteClient } from '../server/client';

const DEFAULT_TOPIC = 'LIVE MODE: WHICH MODEL ARGUES BETTER';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    serve: { type: 'boolean', default: false },
    connect: { type: 'string' },
    side: { type: 'string' },
    port: { type: 'string', default: '0' },
    p1: { type: 'string', default: 'CLAUDE' },
    p2: { type: 'string', default: 'CODEX' },
    topic: { type: 'string', default: DEFAULT_TOPIC },
    brain: { type: 'string', default: 'local' },
    token: { type: 'string' },
    'p1-brain': { type: 'string' },
    'p2-brain': { type: 'string' },
    'max-turns': { type: 'string' }
  },
  allowPositionals: false
});

function asBrainKind(value: string | undefined, fallback: string): BrainKind {
  const kind = value ?? fallback;
  if (kind !== 'local' && kind !== 'openrouter' && kind !== 'claude-tui') {
    throw new Error(`unknown --brain "${kind}" (expected "local", "openrouter", or "claude-tui")`);
  }
  return kind;
}

/** Closes any brain's tmux window (currently only `claude-tui`) once a match is over,
 * win or lose — `local`/`openrouter` brains have nothing to clean up and are skipped
 * via the `hasDispose` duck-typed guard. Never throws: a cleanup failure is logged but
 * must not mask the match's own outcome/error. */
async function disposeBrains(brains: FighterBrain[]): Promise<void> {
  for (const brain of brains) {
    if (!hasDispose(brain)) continue;
    try {
      await brain.dispose();
    } catch (err) {
      console.error(`warning: failed to dispose brain "${brain.kind}": ${(err as Error).message}`);
    }
  }
}

/** Brains created by whichever mode is currently running, so a SIGINT/SIGTERM handler
 * (registered once, below) can dispose them even if the process is killed mid-match —
 * e.g. an external supervisor's timeout fallback (`kill $PID`) rather than the normal
 * finally-block path in `runLocalMode`/`runConnectMode`. Node's default behavior for an
 * unhandled SIGTERM is to terminate immediately with NO pending `finally` blocks run at
 * all, which would otherwise leave a `claude-tui` brain's tmux window orphaned forever
 * whenever the process is killed rather than left to exit on its own. */
const activeBrains: FighterBrain[] = [];
let shuttingDown = false;

async function shutdownOnSignal(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`\nreceived ${signal} — cleaning up before exit`);
  await disposeBrains(activeBrains);
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => {
  void shutdownOnSignal('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdownOnSignal('SIGTERM');
});

async function main(): Promise<void> {
  if (values.connect) {
    await runConnectMode();
  } else if (values.serve) {
    runServeMode();
  } else {
    await runLocalMode();
  }
}

/** Deliverable 1: a full local match, both sides driven in-process, no network. */
async function runLocalMode(): Promise<void> {
  const names: Names = { p1: values.p1!, p2: values.p2! };
  const p1Brain = createBrain(asBrainKind(values['p1-brain'], values.brain!));
  const p2Brain = createBrain(asBrainKind(values['p2-brain'], values.brain!));
  activeBrains.push(p1Brain, p2Brain);

  try {
    const engine = new FightEngine('p1', names.p1, names.p2);
    const source = createLiveSource(values.topic!, names, { p1: p1Brain, p2: p2Brain });

    console.log('='.repeat(64));
    console.log('PROMPT FIGHTER — LIVE MODE (local CLI)');
    console.log(`${names.p1} vs ${names.p2} — "${values.topic}"`);
    console.log(`brains: p1=${p1Brain.kind}  p2=${p2Brain.kind}`);
    console.log('='.repeat(64));
    console.log(`\n--- ROUND ${engine.state.round} — FIGHT! ---`);

    let winner: Speaker | undefined;
    engine.on((event) => {
      const line = formatEvent(event, names);
      if (line) console.log(line);
      if (event.type === 'matchEnd') winner = event.winner;
      if (event.type === 'roundEnd' && !engine.matchOver) {
        console.log(`\n--- ROUND ${engine.state.round} — FIGHT! ---`);
      }
    });

    await runLiveMatch(engine, source, {
      maxTurns: values['max-turns'] ? Number(values['max-turns']) : undefined,
      onTurnStart: (speaker, text) => console.log(formatTurnHeader(speaker, names, text)),
      onTurnResolved: () => console.log(formatCredibility(engine.state, names))
    });

    console.log('\n' + '='.repeat(64));
    if (winner) {
      console.log(
        `FINAL RESULT: ${names[winner]} wins the match ` +
          `(${engine.state.p1.roundsWon}-${engine.state.p2.roundsWon} rounds).`
      );
    } else {
      console.log('FINAL RESULT: no decisive winner within the turn budget (bounded run terminated).');
    }
    console.log('='.repeat(64));
    process.exitCode = 0;
  } finally {
    await disposeBrains([p1Brain, p2Brain]);
  }
}

/** Deliverable 2, server half: holds the one authoritative `FightEngine` and lets
 * remote clients connect over the network. */
function runServeMode(): void {
  const names: Names = { p1: values.p1!, p2: values.p2! };
  console.log(`starting live-mode server — ${names.p1} vs ${names.p2} — "${values.topic}"`);

  startServer({
    port: Number(values.port),
    token: values.token,
    p1Name: names.p1,
    p2Name: names.p2,
    topic: values.topic,
    onListening: (port, token) => {
      // The connect URL carries the token, so joining stays one copy-paste with no
      // extra step. Quoted because `?` is a glob character in bash/zsh — an
      // unquoted URL would fail to expand before the CLI ever saw it.
      const connect = `"http://127.0.0.1:${port}?token=${token}"`;
      console.log(`listening on http://127.0.0.1:${port}`);
      console.log(`  match token: ${token}`);
      console.log(`  clients: npm run fight -- --connect ${connect} --side p1`);
      console.log(`           npm run fight -- --connect ${connect} --side p2`);
    },
    onMatchOver: (session) => {
      const winnerSide = session.engine.state.p1.roundsWon > session.engine.state.p2.roundsWon ? 'p1' : 'p2';
      console.log(`\nMATCH OVER on the server — winner: ${session.names[winnerSide]}`);
      // Give the SSE broadcast a moment to flush to any connected clients before the
      // process (and any spectators still reading it) goes away.
      setTimeout(() => process.exit(0), 500);
    }
  });
}

/** Deliverable 2, client half: one process, one side, driven by a brain, talking to
 * an already-running `--serve` process over the network. */
async function runConnectMode(): Promise<void> {
  const side = values.side;
  if (side !== 'p1' && side !== 'p2') {
    throw new Error('--connect requires --side p1 or --side p2');
  }
  const brain = createBrain(asBrainKind(values.brain, 'local'));
  activeBrains.push(brain);
  console.log(`connecting to ${values.connect} as ${side} (brain: ${brain.kind})`);
  try {
    await runRemoteClient({ url: values.connect!, side, brain, token: values.token });
    process.exitCode = 0;
  } finally {
    await disposeBrains([brain]);
  }
}

main().catch((err) => {
  console.error(`\nlive mode failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
