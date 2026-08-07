/**
 * Pure-spectator match source: watches a live match on a remote `http.ts` server
 * without ever driving a brain or submitting a turn. It is wired through the exact
 * same `MatchSource` / `StreamHandlers` seam `replay.ts` and `live.ts` implement —
 * the engine and renderer cannot tell a spectate feed apart from a locally driven
 * one — plus the optional `onServerSnapshot` extension point (see `types.ts`) that
 * lets a caller mirror the server's authoritative credibility/round/matchOver state
 * and combat events instead of recomputing any of the engine's own rules.
 *
 * Two pieces, deliberately separated:
 *  - `SpectateReducer` is a pure, synchronous state machine: feed it one
 *    `SessionSnapshot` at a time, get back handler calls and whether a turn just
 *    resolved. No timers, no I/O — fully unit-testable (see
 *    `tests/spectate-source.test.ts`).
 *  - `createSpectateSource` is the impure shell: it owns the network (a `/state`
 *    fetch plus a hand-rolled SSE reader against `/stream`), buffers incoming
 *    snapshots, and drains them through a shared `SpectateReducer` one at a time as
 *    `nextTurn()` is called.
 */

import type { Speaker } from '../engine/types';
import type { SessionSnapshot } from '../server/session';
import type { MatchSource, StreamHandlers } from './types';

/**
 * Applies one `SessionSnapshot` to a set of `StreamHandlers`, tracking only what it
 * needs to decide whether a wind-up is already open for the upcoming speaker:
 *
 *  - `'hello'`  — the initial full-history snapshot on connect. No-op here: the
 *    spectator only cares about *live* turns going forward, not replaying history
 *    into the fighter rig. Returns `false` (no turn resolved).
 *  - `'thinking'` — the opponent side is composing. Opens the wind-up
 *    (`onTurnStart`) for `nextSpeaker` and remembers it, so a later `'turn'`
 *    snapshot for the *same* speaker does not reopen it. Returns `false`.
 *  - `'turn'` — a turn just landed. If no wind-up is currently open for that turn's
 *    speaker (no `'thinking'` snapshot ever arrived for them — the server may skip
 *    it, or a spectator may join mid-turn), falls back to calling `onTurnStart`
 *    first so the rig still gets its wind-up pose. Either way then fires
 *    `onTurnChunk` with the full text (the server does not stream individual
 *    tokens to spectators — one full snapshot per completed turn),
 *    `onServerSnapshot` with the authoritative credibility/round/matchOver/events
 *    (never computed here), and finally `onTurnEnd`. Returns `true`.
 */
export class SpectateReducer {
  private openFor: Speaker | null = null;

  apply(snapshot: SessionSnapshot, handlers: StreamHandlers): boolean {
    if (snapshot.type === 'thinking') {
      handlers.onTurnStart(snapshot.nextSpeaker);
      this.openFor = snapshot.nextSpeaker;
      return false;
    }

    if (snapshot.type !== 'turn') {
      // 'hello' (or anything else unrecognized): nothing to resolve.
      return false;
    }

    const turn = snapshot.turns[snapshot.turns.length - 1];
    if (!turn) return false;

    if (this.openFor !== turn.speaker) {
      handlers.onTurnStart(turn.speaker);
    }
    this.openFor = null;

    handlers.onTurnChunk(turn.speaker, turn.text);
    handlers.onServerSnapshot?.({
      credibility: snapshot.credibility,
      round: snapshot.round,
      matchOver: snapshot.matchOver,
      events: snapshot.events
    });
    handlers.onTurnEnd(turn.speaker, turn.text);

    return true;
  }
}

async function fetchState(base: string, token: string | undefined): Promise<SessionSnapshot> {
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const res = await fetch(`${base}/state${qs}`);
  if (!res.ok) throw new Error(`spectate: could not reach ${base}/state: ${res.status} ${res.statusText}`);
  return (await res.json()) as SessionSnapshot;
}

/**
 * Hand-rolled SSE line reader against `/stream`, matching `server/client.ts`'s
 * `streamSSE` line-parsing shape (split on `\n\n`, pull the `data: ` line) but
 * deliberately NOT imported from it: `client.ts` authenticates with an
 * `Authorization` header, which is fine for a Node-to-Node client but would force
 * a CORS preflight (`OPTIONS`) on every browser SSE connection — the token here
 * travels only as a `?token=` query param instead (see `fetchState` above), so the
 * request stays a simple GET with no custom header and no preflight. Duplicating
 * the ~15 lines of parsing is cheaper than sharing a helper that would need an
 * auth-strategy parameter threaded through a Node-only module.
 */
async function streamSSE(
  base: string,
  token: string | undefined,
  signal: AbortSignal,
  onMessage: (snapshot: SessionSnapshot) => void
): Promise<void> {
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const res = await fetch(`${base}/stream${qs}`, { signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`spectate: SSE connect failed: ${res.status}`);

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

/**
 * Connects to a running match as a pure spectator: no brain, no turn submission,
 * ever. `nextTurn()` drains one buffered snapshot at a time through a shared
 * `SpectateReducer`, so the resolved-turn cadence matches how many `'turn'`
 * broadcasts have actually arrived rather than any local timer.
 *
 * Deliberate decision: `nextTurn()` never resolves `false` on a mid-match stream
 * drop (a network blip, the server restarting) — only when the queue is empty AND
 * the reducer has already seen `matchOver: true`. A spectator's `MatchSource`
 * returning `false` is what a caller's run-loop reads as "match over, stop
 * driving" (see `main.ts`'s `runLoop`); resolving `false` on a transient drop
 * would end the match on-screen for a spectator even though the real fight is
 * still going, forcing a full page reload to resume. Instead a drop simply stalls
 * `nextTurn()`'s promise until the next reconnect delivers a fresh snapshot (or
 * the caller calls `stop()`), matching the "hold the wind-up open, no timeout"
 * behavior `SpectateReducer` already has for an in-progress turn.
 */
export async function createSpectateSource(serverUrl: string, token?: string): Promise<MatchSource> {
  const base = serverUrl.replace(/\/$/, '');
  const initial = await fetchState(base, token);

  const reducer = new SpectateReducer();
  const queue: SessionSnapshot[] = [];
  let waiter: (() => void) | null = null;
  let stopped = false;
  const controller = new AbortController();

  const wake = () => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };

  const push = (snapshot: SessionSnapshot) => {
    queue.push(snapshot);
    wake();
  };

  // The initial `/state` fetch is itself a `'hello'`-shaped snapshot (full history,
  // current turn order) — feed it through the same queue so a spectator joining
  // mid-match sees the live server's current `matchOver`/credibility state via
  // `onServerSnapshot` on the very first drained turn too, without a special case.
  push(initial);

  streamSSE(base, token, controller.signal, push).catch(() => {
    // A dropped/errored stream does not end the match for a spectator — see the
    // "never resolves false on a stream drop" doc comment above. Nothing further
    // to do here; `nextTurn()` simply keeps waiting for a snapshot that may never
    // come again, exactly like an idle-but-not-over match.
  });

  let matchOver = false;

  return {
    topic: initial.topic,
    names: initial.names,

    async nextTurn(handlers: StreamHandlers): Promise<boolean> {
      while (true) {
        if (stopped) return false;

        const snapshot = queue.shift();
        if (!snapshot) {
          if (matchOver) return false;
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
          continue;
        }

        if (snapshot.matchOver) matchOver = true;
        const resolved = reducer.apply(snapshot, handlers);
        if (resolved) return true;
        // A 'thinking' (or 'hello') snapshot resolved no turn — keep draining the
        // queue rather than returning false, since false would (incorrectly) read
        // as "match over" to a caller's run-loop.
      }
    },

    reset() {
      // A spectator never rewinds — the server is the single timeline. No-op.
    },

    stop() {
      stopped = true;
      controller.abort();
      wake();
    }
  };
}
