/**
 * Integration-level coverage for the actual network transport (`node:http`, real
 * sockets, real SSE) — `tests/server-session.test.ts` covers the pure session logic
 * without a socket in the loop; this file is what proves the two client edge cases
 * the task calls out (out-of-order submission, a second client joining mid-match)
 * hold up over the wire, not just in-process.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { startServer } from '../src/server/http';

let server: Server;
let origin: string;
let token: string;
/** Every route is behind the match token, so the transport tests below address the
 * server through this — the auth suite is what exercises presenting a wrong token
 * or none at all. */
let baseUrl: (path: string) => string;

beforeEach(async () => {
  ({ origin, token } = await new Promise<{ origin: string; token: string }>((resolve) => {
    server = startServer({
      port: 0,
      p1Name: 'CLAUDE',
      p2Name: 'CODEX',
      topic: 'TEST TOPIC',
      onListening: (port, matchToken) =>
        resolve({ origin: `http://127.0.0.1:${port}`, token: matchToken })
    });
  }));
  baseUrl = (path) => `${origin}${path}?token=${token}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /state', () => {
  it('reports the match as fresh, p1 to move', async () => {
    const res = await fetch(baseUrl('/state'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextSpeaker).toBe('p1');
    expect(body.matchOver).toBe(false);
    expect(body.names).toEqual({ p1: 'CLAUDE', p2: 'CODEX' });
  });
});

describe('POST /turn', () => {
  it('accepts a valid turn from the side whose turn it is', async () => {
    const res = await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p1', text: 'A short jab.' })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.some((e: { type: string }) => e.type === 'attack')).toBe(true);
    expect(body.nextSpeaker).toBe('p2');
  });

  it('rejects a turn submitted out of order with 409', async () => {
    const res = await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p2', text: 'jumping the queue' })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not p2's turn/);
  });

  it('rejects a missing text field with 400, not a stack trace', async () => {
    const res = await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p1' })
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown speaker with 400', async () => {
    const res = await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p3', text: 'hello' })
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    expect(res.status).toBe(400);
  });
});

/**
 * The 2026-08-06 review impersonated BOTH p1 and p2 on a live server via
 * unauthenticated `POST /turn`. These are the cases that close that hole.
 */
describe('match token', () => {
  const post = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      body: JSON.stringify({ speaker: 'p1', text: 'A short jab.' })
    });

  it('rejects an unauthenticated POST /turn with 401', async () => {
    const res = await post(`${origin}/turn`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/token/i);
  });

  it('rejects a wrong token with 401', async () => {
    const res = await post(`${origin}/turn?token=not-the-real-token`);
    expect(res.status).toBe(401);
  });

  it('leaves the match untouched by a rejected turn', async () => {
    await post(`${origin}/turn`);
    const state = await (await fetch(baseUrl('/state'))).json();
    expect(state.turns).toEqual([]);
    expect(state.nextSpeaker).toBe('p1');
  });

  it('accepts a correctly-tokened POST /turn', async () => {
    const res = await post(baseUrl('/turn'));
    expect(res.status).toBe(200);
    expect((await res.json()).nextSpeaker).toBe('p2');
  });

  it('accepts the token as an Authorization: Bearer header too', async () => {
    const res = await post(`${origin}/turn`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it('guards GET /state and GET /stream, not just POST /turn', async () => {
    expect((await fetch(`${origin}/state`)).status).toBe(401);
    const res = await fetch(`${origin}/stream`, { headers: { Accept: 'text/event-stream' } });
    expect(res.status).toBe(401);
  });

  it('mints a distinct token per server start', async () => {
    const second = await new Promise<{ srv: Server; token: string }>((resolve) => {
      const srv = startServer({ port: 0, onListening: (_p, t) => resolve({ srv, token: t }) });
    });
    expect(second.token).not.toBe(token);
    expect(second.token.length).toBeGreaterThanOrEqual(16);
    second.srv.closeAllConnections();
    await new Promise<void>((resolve) => second.srv.close(() => resolve()));
  });
});

describe('GET /stream (SSE)', () => {
  it('a second client connecting mid-match immediately replays full history', async () => {
    await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p1', text: 'A short jab.' })
    });

    const controller = new AbortController();
    const res = await fetch(baseUrl('/stream'), {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' }
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    const payload = JSON.parse(chunk.replace(/^data: /, '').trim());

    expect(payload.type).toBe('hello');
    expect(payload.turns).toEqual([{ speaker: 'p1', text: 'A short jab.' }]);
    expect(payload.nextSpeaker).toBe('p2');

    controller.abort();
  });

  it('broadcasts a turn to an already-connected client', async () => {
    const controller = new AbortController();
    const res = await fetch(baseUrl('/stream'), {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' }
    });
    const reader = res.body!.getReader();
    await reader.read(); // consume the initial `hello`

    await fetch(baseUrl('/turn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: 'p1', text: 'A short jab.' })
    });

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    const payload = JSON.parse(chunk.replace(/^data: /, '').trim());
    expect(payload.type).toBe('turn');
    expect(payload.turns[0]).toEqual({ speaker: 'p1', text: 'A short jab.' });

    controller.abort();
  });
});
