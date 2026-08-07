/**
 * The `--connect` client's own pure seam. The networked round trip itself is
 * covered by `tests/server-http.test.ts` (real sockets, real SSE) and by the CLI
 * behavioural run; what matters here is that a connect URL copied verbatim out of
 * `--serve`'s output carries its token through to the request layer, because that
 * is what keeps joining a match a single copy-paste with no manual step.
 */

import { describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import { ClientState, parseConnectUrl, runRemoteClient } from '../src/server/client';
import { startServer } from '../src/server/http';
import { createLocalBrain } from '../src/brains/local';
import type { SessionSnapshot } from '../src/server/session';
import type { FighterBrain } from '../src/brains/types';

/** Fails (rejects) instead of hanging if `p` does not settle in time — so a
 * regression of the very bug under test surfaces as a failed assertion, not a
 * hung test run. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMED OUT after ${ms}ms: ${label}`)), ms).unref?.()
    )
  ]);
}

function listen(opts: Parameters<typeof startServer>[0] = {}): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = startServer({
      ...opts,
      onListening: (port, token) => resolve({ server, url: `http://127.0.0.1:${port}?token=${token}` })
    });
  });
}

const closeServer = (server: Server) => {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
};

describe('parseConnectUrl', () => {
  it('splits the token out of a URL as `--serve` prints it', () => {
    expect(parseConnectUrl('http://127.0.0.1:8991?token=abc123')).toEqual({
      base: 'http://127.0.0.1:8991',
      token: 'abc123'
    });
  });

  it('leaves a plain URL alone, with no token', () => {
    expect(parseConnectUrl('http://127.0.0.1:8991')).toEqual({
      base: 'http://127.0.0.1:8991',
      token: undefined
    });
  });

  it('never leaves the token on the base URL used to build request paths', () => {
    // Regression guard: `${base}/turn` must not become `...?token=x/turn`.
    const { base } = parseConnectUrl('http://127.0.0.1:8991?token=abc123');
    expect(`${base}/turn`).toBe('http://127.0.0.1:8991/turn');
  });

  it('tolerates a trailing slash, extra params and a real hostname', () => {
    expect(parseConnectUrl('http://fight.example.com:8080/?token=t&spectate=1')).toEqual({
      base: 'http://fight.example.com:8080',
      token: 't'
    });
  });
});

/**
 * The SSE-hang fix: a `--connect` client blocked waiting for the next turn must
 * detect a dropped connection and error out within a bounded time, never block
 * forever on a gate that will never be notified again. This is the structural root
 * cause round 2 flagged behind "a networked match sometimes stalls".
 */
describe('runRemoteClient survives a dropped connection', () => {
  it('errors out (does not hang) when the server drops mid-match', async () => {
    const { server, url } = await listen({ p1Name: 'CLAUDE', p2Name: 'CODEX' });
    // side p2: it is p1's turn first, so this client receives `hello` then blocks
    // on the internal gate waiting for p1's turn — the exact hang state.
    const clientPromise = runRemoteClient({ url, side: 'p2', brain: createLocalBrain(), log: () => {} });

    // Give it a moment to connect + reach the waiting state, then hard-drop the server.
    await new Promise((r) => setTimeout(r, 150));
    await closeServer(server);

    await expect(withTimeout(clientPromise, 8_000, 'client after server drop')).rejects.toThrow(
      /lost connection to the match server/i
    );
  });

  it('errors out via the idle-timeout when the stream goes silent (no heartbeat)', async () => {
    // Heartbeat effectively disabled + a tiny idle window: after `hello` no bytes
    // ever arrive, so the watchdog must fire and end the client — proving the
    // timeout half of the mechanism, not just the socket-close half above.
    const { server, url } = await listen({ heartbeatMs: 10_000_000 });
    const clientPromise = runRemoteClient({
      url,
      side: 'p2',
      brain: createLocalBrain(),
      log: () => {},
      idleTimeoutMs: 300
    });

    await expect(withTimeout(clientPromise, 5_000, 'client idle timeout')).rejects.toThrow(
      /lost connection to the match server/i
    );
    await closeServer(server);
  });
});

describe('ClientState.apply merges a late "hello" snapshot (the late-join / reconnect race)', () => {
  it('catches turnCount and lastText up when a turn landed between the /state fetch and the /stream connect', () => {
    const names = { p1: 'CLAUDE', p2: 'CODEX' };
    const initial: SessionSnapshot = {
      type: 'hello',
      topic: 'T',
      names,
      nextSpeaker: 'p2',
      matchOver: false,
      credibility: { p1: 100, p2: 100 },
      roundsWon: { p1: 0, p2: 0 },
      round: 1,
      turns: [{ speaker: 'p1', text: 'first line' }],
      events: []
    };
    const client = new ClientState(names, initial);
    expect(client.turnCount).toBe(1);

    const raced: SessionSnapshot = {
      ...initial,
      nextSpeaker: 'p1',
      turns: [
        { speaker: 'p1', text: 'first line' },
        { speaker: 'p2', text: 'second line, missed by /state' }
      ],
      events: []
    };
    const lines: string[] = [];
    client.apply(raced, (line) => lines.push(line));

    expect(client.turnCount).toBe(2);
    expect(client.lastText.p2).toBe('second line, missed by /state');
    expect(lines.some((l) => l.includes('second line, missed by /state'))).toBe(true);
  });
});

/**
 * The "thinking" broadcast (`http.ts`'s `POST /thinking`, fired fire-and-forget
 * from `runRemoteClient` right before `brain.nextMessage`) exists so a spectator
 * sees "X is thinking" instead of silence while a real brain composes. This proves
 * the ordering that makes it useful: for a brain slow enough to matter, the
 * `thinking` snapshot for a turn must reach the wire before that turn's own `turn`
 * snapshot does — an independent SSE spectator, not the `runRemoteClient` under
 * test, observes both.
 */
describe('a "thinking" snapshot precedes the "turn" snapshot it announces', () => {
  it('reaches a spectator before the turn, for a brain slow to compose', async () => {
    const { server, url } = await listen({ p1Name: 'CLAUDE', p2Name: 'CODEX' });
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token')!;

    const slowBrain: FighterBrain = {
      kind: 'slow-test-brain',
      nextMessage: () => new Promise((resolve) => setTimeout(() => resolve('A slow jab.'), 200))
    };

    // An independent spectator connection — the thing that must observe both
    // broadcasts, in order, regardless of what `runRemoteClient` itself does.
    const streamRes = await fetch(`${parsed.origin}/stream?token=${token}`, {
      headers: { Accept: 'text/event-stream' }
    });
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextEvent = async (): Promise<{ type: string; nextSpeaker?: string }> => {
      for (;;) {
        const idx = buffer.indexOf('\n\n');
        if (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) return JSON.parse(dataLine.slice(6));
          continue; // a heartbeat comment (`: ping`) — keep reading, not a real message
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('spectator stream ended');
        buffer += decoder.decode(value, { stream: true });
      }
    };

    await nextEvent(); // consume the initial `hello`

    // side p1: nextSpeaker starts p1, so this client composes (slowly) immediately.
    const clientPromise = runRemoteClient({ url, side: 'p1', brain: slowBrain, log: () => {} });

    const thinking = await withTimeout(nextEvent(), 5_000, 'thinking snapshot');
    expect(thinking.type).toBe('thinking');
    expect(thinking.nextSpeaker).toBe('p1');

    const turn = await withTimeout(nextEvent(), 5_000, 'turn snapshot for the same turn');
    expect(turn.type).toBe('turn');

    await reader.cancel().catch(() => {});
    await closeServer(server);
    await clientPromise.catch(() => {}); // client errors once the server closes — expected here
  });
});
