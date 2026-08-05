/**
 * Lightweight transport for `MatchSession`: `node:http` only, no new runtime
 * dependency. SSE for server -> client broadcast (the design doc's own documented
 * direction for live mode), a POST for a client submitting its turn.
 *
 * Two separate client processes point at this over the network and play a match to
 * completion; the server holds the one authoritative `FightEngine` via
 * `MatchSession`, so neither client ever runs its own copy of the rules.
 *
 * Edge cases handled here, simply and predictably (see inline comments at each):
 * a second client connecting, a client disconnecting mid-match, a turn submitted
 * out of order.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MatchSession, type MatchSessionOptions } from './session';

export interface StartServerOptions extends MatchSessionOptions {
  port?: number;
  /** Called once the server is actually listening, with the port it bound to —
   * useful when `port` is `0` (OS-assigned), which is how the tests and the
   * behavioural verification run avoid colliding on a fixed port. */
  onListening?: (port: number) => void;
  /** Called once, the turn after the match ends — the caller decides whether to
   * keep the process (and any spectators) around or shut down. */
  onMatchOver?: (session: MatchSession) => void;
}

function sseWrite(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function respondJSON(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readJSONBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function startServer(options: StartServerOptions = {}): Server {
  const session = new MatchSession(options);
  // Every open SSE connection — spectators, players, a reconnecting client after a
  // drop. A second (or third, fourth...) client connecting just adds another entry
  // here; nothing about accepting a new stream depends on how many are already open.
  const clients = new Set<ServerResponse>();

  const broadcast = (payload: unknown) => {
    for (const res of clients) sseWrite(res, payload);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      // Full history replay so a client that connects late — or reconnects after a
      // mid-match drop — catches up from `hello` alone, no separate backfill call.
      sseWrite(res, session.hello());
      clients.add(res);
      req.on('close', () => {
        // A client disconnecting mid-match just stops receiving broadcasts; the
        // match keeps running and waits for its next turn like any other silence.
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      respondJSON(res, 200, session.hello());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/turn') {
      readJSONBody(req)
        .then((body) => {
          const { speaker, text } = (body ?? {}) as { speaker?: unknown; text?: unknown };
          if (speaker !== 'p1' && speaker !== 'p2') {
            return respondJSON(res, 400, { error: 'speaker must be "p1" or "p2"' });
          }
          if (typeof text !== 'string' || !text.trim()) {
            return respondJSON(res, 400, { error: 'text is required' });
          }
          try {
            // A turn submitted out of order (wrong speaker, or after matchOver) is
            // rejected here with a specific reason — `MatchSession.submitTurn` is
            // the single place that decides "whose turn is it", so two client
            // processes racing each other always resolve the same way a solo
            // process would.
            const events = session.submitTurn(speaker, text);
            const payload = session.turnSnapshot(speaker, text, events);
            broadcast(payload);
            respondJSON(res, 200, payload);
            if (session.matchOver) options.onMatchOver?.(session);
          } catch (err) {
            respondJSON(res, 409, { error: (err as Error).message });
          }
        })
        .catch((err) => respondJSON(res, 400, { error: (err as Error).message }));
      return;
    }

    respondJSON(res, 404, { error: 'not found' });
  });

  server.listen(options.port ?? 0, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
    options.onListening?.(port);
  });

  return server;
}
