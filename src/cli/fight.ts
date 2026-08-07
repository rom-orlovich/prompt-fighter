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
import { pathToFileURL } from 'node:url';
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

const CLI_OPTIONS = {
  serve: { type: 'boolean', default: false },
  connect: { type: 'string' },
  side: { type: 'string' },
  port: { type: 'string', default: '0' },
  host: { type: 'string', default: '127.0.0.1' },
  p1: { type: 'string', default: 'CLAUDE' },
  p2: { type: 'string', default: 'CODEX' },
  topic: { type: 'string', default: DEFAULT_TOPIC },
  brain: { type: 'string', default: 'local' },
  token: { type: 'string' },
  'p1-brain': { type: 'string' },
  'p2-brain': { type: 'string' },
  'max-turns': { type: 'string' },
  help: { type: 'boolean', default: false, short: 'h' }
} as const;

export type CliValues = ReturnType<typeof parseArgs<{ options: typeof CLI_OPTIONS }>>['values'];

/** Parses CLI args (defaulting to `process.argv.slice(2)`) into `values`, kept as a
 * standalone export so tests can exercise flag parsing without the module's own
 * top-level `process.argv` parsing (guarded behind `isMainModule()` below) firing. */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliValues {
  const { values } = parseArgs({
    args: argv,
    options: CLI_OPTIONS,
    allowPositionals: false
  });
  return values;
}

/** Human-readable usage/help text for `--help`/`-h`, also unit-tested directly so the
 * documented flags stay in sync with `CLI_OPTIONS`. */
export function buildUsage(): string {
  return `Usage: npm run fight -- [options]

Modes:
  (no flags)                         local full match, both sides in-process
  --serve [--port N] [--host H]      start the authoritative server
  --connect <url> --side p1|p2       join a running server as one side

Options:
  --serve                 start server mode
  --connect <url>          connect to a running server
  --side p1|p2              which side to play in --connect mode
  --port <n>                 server port (default: 0, i.e. OS-assigned)
  --host <h>                 server bind/connect host (default: 127.0.0.1)
  --token <t>                match token (serve: pin it, connect: pass it)
  --p1 <name>                 name for player 1 (default: CLAUDE)
  --p2 <name>                 name for player 2 (default: CODEX)
  --topic <t>                 debate topic
  --brain <kind>              brain kind for both sides unless overridden
  --p1-brain <kind>            brain kind for p1 only
  --p2-brain <kind>            brain kind for p2 only
  --max-turns <n>              cap the number of turns in local mode
  --help, -h                   show this help and exit
`;
}

/** Builds the connect URL clients use to join a `--serve` process, with `host`
 * threaded through instead of a hardcoded 127.0.0.1 string. */
export function connectUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}?token=${token}`;
}

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

async function main(values: CliValues): Promise<void> {
  if (values.help) {
    console.log(buildUsage());
    process.exitCode = 0;
    return;
  }

  if (values.connect) {
    await runConnectMode(values);
  } else if (values.serve) {
    runServeMode(values);
  } else {
    await runLocalMode(values);
  }
}

/** Deliverable 1: a full local match, both sides driven in-process, no network. */
async function runLocalMode(values: CliValues): Promise<void> {
  const names: Names = { p1: values.p1!, p2: values.p2! };
  const p1Brain = await createBrain(asBrainKind(values['p1-brain'], values.brain!));
  const p2Brain = await createBrain(asBrainKind(values['p2-brain'], values.brain!));
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
    await disposeBrains(activeBrains);
  }
}

/** Deliverable 2, server half: holds the one authoritative `FightEngine` and lets
 * remote clients connect over the network. */
function runServeMode(values: CliValues): void {
  const names: Names = { p1: values.p1!, p2: values.p2! };
  const host = values.host!;
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
      const connect = `"${connectUrl(host, port, token)}"`;
      console.log(`listening on http://${host}:${port}`);
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
async function runConnectMode(values: CliValues): Promise<void> {
  const side = values.side;
  if (side !== 'p1' && side !== 'p2') {
    throw new Error('--connect requires --side p1 or --side p2');
  }
  const brain = await createBrain(asBrainKind(values.brain, 'local'));
  activeBrains.push(brain);
  console.log(`connecting to ${values.connect} as ${side} (brain: ${brain.kind})`);
  try {
    await runRemoteClient({ url: values.connect!, side, brain, token: values.token });
    process.exitCode = 0;
  } finally {
    await disposeBrains(activeBrains);
  }
}

/** True only when this file is being run directly (e.g. `node dist-node/fight.mjs`),
 * not when imported (e.g. by tests) — compares this module's URL against the
 * entrypoint script's, the standard ESM stand-in for CommonJS's `require.main ===
 * module`. Guards both the SIGINT/SIGTERM registration and `argv` parsing/`main()`
 * dispatch below, so importing this file never touches `process.argv` or installs
 * signal handlers as a side effect. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  process.on('SIGINT', () => {
    void shutdownOnSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdownOnSignal('SIGTERM');
  });

  const values = parseCliArgs();
  main(values).catch((err) => {
    console.error(`\nlive mode failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
