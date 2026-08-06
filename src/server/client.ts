/**
 * Remote client: connects a single process to a running `http.ts` server over the
 * network (plain `fetch` for `/state` and `/turn`, a hand-rolled SSE reader for
 * `/stream` — no new runtime dependency, Node's global `fetch` already streams the
 * response body). Drives one side of the match with a `FighterBrain`, submitting a
 * turn whenever the server says it is this side's turn, and prints the same way the
 * local CLI does so both deliverables read identically on stdout.
 *
 * Two processes running this against the same server, one per side, is what
 * "two separate processes... exchanging turns through the server" means in
 * practice — see `fight.ts`'s `--connect` mode.
 */

import type { BrainContext, FighterBrain } from '../brains/types';
import type { Speaker } from '../engine/types';
import type { SessionSnapshot } from './session';
import { formatCredibilityLine, formatEvent, formatTurnHeader, type Names } from '../cli/format';

const other = (s: Speaker): Speaker => (s === 'p1' ? 'p2' : 'p1');

/** Resolves each pending `wait()` the moment `notify()` is called — used to block the
 * submit loop until an SSE message says it's this side's turn (or the match ended)
 * instead of busy-polling the server. */
class Gate {
  private waiters: (() => void)[] = [];
  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
  wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/**
 * Splits a `--connect` argument into the base URL and the match token, so the
 * token `--serve` prints as part of one pasteable URL
 * (`http://host:port?token=abc`) needs no extra flag or manual step from whoever
 * connects. An explicit `--token` still wins over an embedded one (see
 * `fight.ts`); a URL with neither yields `undefined` and the server answers 401,
 * which is the honest outcome rather than a confusing hang.
 */
export function parseConnectUrl(raw: string): { base: string; token?: string } {
  const parsed = new URL(raw);
  const token = parsed.searchParams.get('token') ?? undefined;
  parsed.search = '';
  parsed.hash = '';
  return { base: parsed.toString().replace(/\/$/, ''), token };
}

export interface RunRemoteClientOptions {
  url: string;
  side: Speaker;
  brain: FighterBrain;
  /** Overrides a token embedded in `url`. */
  token?: string;
  log?: (line: string) => void;
}

export async function runRemoteClient(options: RunRemoteClientOptions): Promise<void> {
  const { side, brain } = options;
  const log = options.log ?? console.log;

  const { base: url, token: urlToken } = parseConnectUrl(options.url);
  const token = options.token ?? urlToken;
  // Sent on every request, including the SSE stream — the server accepts this or
  // `?token=`, and a header keeps the secret out of any URL that gets logged.
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const initial = await fetchState(url, auth);
  const names: Names = initial.names;

  const client = new ClientState(names, initial);
  log(`connected as ${side} (${names[side]}) — vs ${names[other(side)]} — topic: "${initial.topic}"`);
  // A client joining after turns already happened (a late player, or a spectator)
  // still sees the full fight so far, not just the fact that it happened — turn
  // text first, then every resolved event, then where credibility landed.
  if (initial.turns.length > 0) {
    for (const turn of initial.turns) log(formatTurnHeader(turn.speaker, names, turn.text));
    for (const event of initial.events) {
      const line = formatEvent(event, names);
      if (line) log(line);
    }
    log(formatCredibilityLine(initial.credibility.p1, initial.credibility.p2, initial.round, names));
  }

  const controller = new AbortController();
  const gate = new Gate();

  // Caught immediately (not just where it's later awaited): the server closing the
  // connection when the match ends can reject this before the main loop gets back
  // around to it, and an unattached rejection at that point would surface as an
  // unhandled-rejection warning even though it is expected, routine shutdown.
  const streamDone = streamSSE(url, auth, controller.signal, (snapshot) => {
    client.apply(snapshot, log);
    gate.notify();
  }).catch((err) => {
    if (!controller.signal.aborted) log(`  (stream error: ${(err as Error).message})`);
  });

  while (!client.matchOver) {
    if (client.nextSpeaker === side) {
      const ctx: BrainContext = {
        speaker: side,
        opponent: other(side),
        names,
        topic: initial.topic,
        turnIndex: client.turnCount,
        lastOpponentText: client.lastText[other(side)],
        lastOwnText: client.lastText[side]
      };
      const text = await brain.nextMessage(ctx);
      const res = await fetch(`${url}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ speaker: side, text })
      });
      if (!res.ok) {
        // Someone else beat us to this turn (a stale retry, a race at match start) —
        // the server already broadcast the real outcome over SSE, so just log and
        // let the gate below pick up the corrected state rather than retrying blind.
        const body = await res.json().catch(() => ({}));
        log(`  (turn submission rejected: ${(body as { error?: string }).error ?? res.statusText})`);
      }
    }
    if (!client.matchOver) await gate.wait();
  }

  controller.abort();
  await streamDone;
  log(
    client.winner
      ? `\nFINAL: ${names[client.winner]} wins the match!`
      : '\nFINAL: match ended with no decisive winner in the event stream.'
  );
}

/** Client-side view of the match, rebuilt entirely from server snapshots — this is
 * the one place the client tracks anything, and it never resolves combat itself. */
class ClientState {
  nextSpeaker: Speaker;
  matchOver: boolean;
  winner: Speaker | undefined;
  turnCount: number;
  lastText: Record<Speaker, string | undefined> = { p1: undefined, p2: undefined };

  constructor(
    private names: Names,
    initial: SessionSnapshot
  ) {
    this.nextSpeaker = initial.nextSpeaker;
    this.matchOver = initial.matchOver;
    this.turnCount = initial.turns.length;
    for (const turn of initial.turns) this.lastText[turn.speaker] = turn.text;
    this.winner = findWinner(initial.events);
  }

  apply(snapshot: SessionSnapshot, log: (line: string) => void): void {
    if (snapshot.type === 'turn') {
      for (const turn of snapshot.turns) {
        log(formatTurnHeader(turn.speaker, this.names, turn.text));
        this.lastText[turn.speaker] = turn.text;
        this.turnCount += 1;
      }
      for (const event of snapshot.events) {
        const line = formatEvent(event, this.names);
        if (line) log(line);
      }
      log(formatCredibilityLine(snapshot.credibility.p1, snapshot.credibility.p2, snapshot.round, this.names));
      const winner = findWinner(snapshot.events);
      if (winner) this.winner = winner;
    }
    this.nextSpeaker = snapshot.nextSpeaker;
    this.matchOver = snapshot.matchOver;
  }
}

function findWinner(events: SessionSnapshot['events']): Speaker | undefined {
  const matchEnd = events.find((e): e is Extract<typeof e, { type: 'matchEnd' }> => e.type === 'matchEnd');
  return matchEnd?.winner;
}

async function fetchState(url: string, auth: Record<string, string>): Promise<SessionSnapshot> {
  const res = await fetch(`${url}/state`, { headers: auth });
  // A 401 here is the common first-run mistake (connect URL pasted without its
  // `?token=`), so it says that rather than the bare status line the CLI would
  // otherwise print as "live mode failed: ...".
  if (res.status === 401) {
    throw new Error(
      `server at ${url} rejected the match token — connect with the full URL ` +
        '`--serve` printed (it includes `?token=…`), or pass --token'
    );
  }
  if (!res.ok) throw new Error(`could not reach server at ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as SessionSnapshot;
}

async function streamSSE(
  url: string,
  auth: Record<string, string>,
  signal: AbortSignal,
  onMessage: (snapshot: SessionSnapshot) => void
): Promise<void> {
  const res = await fetch(`${url}/stream`, {
    signal,
    headers: { Accept: 'text/event-stream', ...auth }
  });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) onMessage(JSON.parse(dataLine.slice(6)) as SessionSnapshot);
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}
