/**
 * The `--connect` client's own pure seam. The networked round trip itself is
 * covered by `tests/server-http.test.ts` (real sockets, real SSE) and by the CLI
 * behavioural run; what matters here is that a connect URL copied verbatim out of
 * `--serve`'s output carries its token through to the request layer, because that
 * is what keeps joining a match a single copy-paste with no manual step.
 */

import { describe, it, expect } from 'vitest';
import { parseConnectUrl } from '../src/server/client';

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
