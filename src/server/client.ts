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
  /** If no SSE data (a turn broadcast OR a server heartbeat) arrives within this
   * many ms, the connection is presumed dropped and the client errors out rather
   * than blocking forever. Must stay larger than the server's `heartbeatMs` so a
   * warm connection never trips it. Default 25s. */
  idleTimeoutMs?: number;
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
  const idleTimeoutMs = options.idleTimeoutMs ?? 25_000;

  // Set the moment the SSE stream ends or errors while the match is still going and
  // we did not shut it down ourselves — i.e. the server dropped. The main loop below
  // checks this so a dropped connection makes the client exit with an error instead
  // of blocking forever on a `gate.wait()` that would never be notified again (the
  // root cause behind "a networked match sometimes stalls" — a dropped stream used
  // to only log, never unblock the submit loop).
  let connectionLost = false;
  let lostReason = '';
  const markLost = (reason: string) => {
    if (!connectionLost && !controller.signal.aborted && !client.matchOver) {
      connectionLost = true;
      lostReason = reason;
    }
    // Always release a pending wait so the loop re-evaluates and exits, rather than
    // hanging on a gate that has no one left to notify it.
    gate.notify();
  };

  const streamDone = streamSSE(url, auth, controller.signal, idleTimeoutMs, (snapshot) => {
    client.apply(snapshot, log);
    gate.notify();
  })
    .then(() => {
      // Resolved without error: the server closed the stream. If the match is not
      // actually over, that is a mid-match drop, not the routine end-of-match close.
      markLost('server closed the connection');
    })
    .catch((err) => {
      // Caught here (not just where it's later awaited) so an expected end-of-match
      // rejection never surfaces as an unhandled-rejection warning.
      if (!controller.signal.aborted) log(`  (stream error: ${(err as Error).message})`);
      markLost((err as Error).message);
    });

  while (!client.matchOver && !connectionLost) {
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
      // Fire-and-forget: lets a spectator see "X is thinking" the instant
      // composing starts, but this is purely informational — never awaited, and
      // any failure (dropped connection, slow server) is swallowed here so it can
      // never delay or break the match itself.
      void fetch(`${url}/thinking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ speaker: side })
      }).catch(() => {});
      const text = await brain.nextMessage(ctx);
      if (connectionLost) break;
      const res = await fetch(`${url}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ speaker: side, text })
      }).catch((err: unknown) => {
        // A dropped server also fails the POST itself — treat it the same way.
        markLost((err as Error).message);
        return undefined;
      });
      if (res && !res.ok) {
        // Someone else beat us to this turn (a stale retry, a race at match start) —
        // the server already broadcast the real outcome over SSE, so just log and
        // let the gate below pick up the corrected state rather than retrying blind.
        const body = await res.json().catch(() => ({}));
        log(`  (turn submission rejected: ${(body as { error?: string }).error ?? res.statusText})`);
      }
    }
    if (!client.matchOver && !connectionLost) await gate.wait();
  }

  controller.abort();
  await streamDone;

  if (connectionLost && !client.matchOver) {
    // Bounded, explicit failure — `fight.ts`'s `main().catch` turns this into a
    // "live mode failed: …" line and a non-zero exit, instead of a silent hang.
    throw new Error(
      `lost connection to the match server (${lostReason}) — it may have stopped, ` +
        'or the network dropped'
    );
  }

  log(
    client.winner
      ? `\nFINAL: ${names[client.winner]} wins the match!`
      : '\nFINAL: match ended with no decisive winner in the event stream.'
  );
}

/** Client-side view of the match, rebuilt entirely from server snapshots — this is
 * the one place the client tracks anything, and it never resolves combat itself. */
export class ClientState {
  nextSpeaker: Speaker;
  matchOver: boolean;
  winner: Speaker | undefined;
  turnCount: number;
  private eventCount: number;
  lastText: Record<Speaker, string | undefined> = { p1: undefined, p2: undefined };

  constructor(
    private names: Names,
    initial: SessionSnapshot
  ) {
    this.nextSpeaker = initial.nextSpeaker;
    this.matchOver = initial.matchOver;
    this.turnCount = initial.turns.length;
    this.eventCount = initial.events.length;
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
      this.eventCount = snapshot.events.length;
      const winner = findWinner(snapshot.events);
      if (winner) this.winner = winner;
    } else if (snapshot.type === 'hello') {
      // A late-join / reconnect race: a turn landed on the server between this
      // client's `/state` fetch and its `/stream` connect. The only snapshot that
      // ever carries that turn is the SSE stream's first `hello` message — catch
      // history-merging up to it here or the turn (and its events) are silently
      // dropped from the client's view forever.
      if (snapshot.turns.length > this.turnCount) {
        for (const turn of snapshot.turns.slice(this.turnCount)) {
          log(formatTurnHeader(turn.speaker, this.names, turn.text));
          this.lastText[turn.speaker] = turn.text;
        }
        for (const event of snapshot.events.slice(this.eventCount)) {
          const line = formatEvent(event, this.names);
          if (line) log(line);
        }
        log(formatCredibilityLine(snapshot.credibility.p1, snapshot.credibility.p2, snapshot.round, this.names));
        this.turnCount = snapshot.turns.length;
        this.eventCount = snapshot.events.length;
      }
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
  idleTimeoutMs: number,
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
      const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
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

/** One `reader.read()`, but rejected if it takes longer than `ms` — the server's
 * heartbeat guarantees a warm connection produces bytes well inside this window, so
 * exceeding it means the stream has silently gone dead (a half-open socket a plain
 * `read()` would wait on for the OS TCP timeout, minutes later, or never). */
async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const readPromise = reader.read();
  // If the timeout wins the race, this read is abandoned; swallow its eventual
  // settlement so it never surfaces as an unhandled rejection once the caller's
  // AbortController cancels the body.
  readPromise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no data from the server for ${ms}ms — connection presumed dropped`)),
      ms
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([readPromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
