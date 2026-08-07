import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import { startServer } from '../src/server/http';
import { runRemoteClient } from '../src/server/client';
import { createLocalBrain } from '../src/brains/local';
import type { BrainContext, FighterBrain } from '../src/brains/types';

/**
 * Drives a REAL `http.ts` server plus two REAL `runRemoteClient` processes — the
 * exact same code path `npm run fight -- --serve` / `--connect` uses, just called
 * directly in-process (Node side, no subprocess) so this suite runs at unit-test
 * speed instead of paying for real `tmux`/process spawn overhead. The browser page
 * navigated to `?spectate=<origin>&token=<token>` is a genuine spectator over a
 * genuine SSE connection — nothing here is mocked or stubbed.
 *
 * p1 is deliberately slow on its OPENING turn only (`SLOW_TURN_MS`, well under this
 * file's own 30s test timeout but comfortably longer than a network round trip) —
 * long enough to prove the wind-up pose holds for a real, measured gap rather than
 * a canned animation length, without making every spec pay that cost on every turn.
 * Every turn after the first, on both sides, uses the real, instant `local` brain
 * (`src/brains/local.ts`) so the rest of the match resolves quickly.
 */
const SLOW_TURN_MS = 2500;

function createSlowFirstTurnBrain(): FighterBrain {
  const local = createLocalBrain();
  let firstTurn = true;
  return {
    kind: 'test-slow-first-turn',
    async nextMessage(ctx: BrainContext): Promise<string> {
      if (firstTurn) {
        firstTurn = false;
        await new Promise((resolve) => setTimeout(resolve, SLOW_TURN_MS));
      }
      return local.nextMessage(ctx);
    }
  };
}

let server: Server;
let origin: string;
let token: string;

test.beforeEach(async () => {
  ({ origin, token } = await new Promise<{ origin: string; token: string }>((resolve) => {
    server = startServer({
      port: 0,
      p1Name: 'CLAUDE',
      p2Name: 'CODEX',
      topic: 'DOES A SPECTATOR SEE THE REAL HANDSHAKE?',
      onListening: (port, matchToken) =>
        resolve({ origin: `http://127.0.0.1:${port}`, token: matchToken })
    });
  }));
});

test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Starts the two real `--connect`-equivalent client processes against the server
 * already running for this test. Errors from either (e.g. the server closing in
 * `afterEach` while a client is still mid-loop) are swallowed here — the test's own
 * assertions are what decide pass/fail, not whether a background client's promise
 * ever settles cleanly. */
function startRealPlayers(): void {
  const url = `${origin}?token=${token}`;
  void runRemoteClient({ url, side: 'p1', brain: createSlowFirstTurnBrain() }).catch(() => {});
  void runRemoteClient({ url, side: 'p2', brain: createLocalBrain() }).catch(() => {});
}

test.describe('spectate mode', () => {
  test('spectate mode connects via query params and receives real snapshots through to match end', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/?spectate=${encodeURIComponent(origin)}&token=${token}&fast=1`);

    // The spectate source's initial `/state` fetch resolves the matchup before any
    // real client ever connects — a spectator sees the empty ring waiting, not a
    // blank page.
    await page.waitForFunction(
      () => (window as unknown as { __pf: { selection: unknown } }).__pf.selection !== null,
      null,
      { polling: 100 }
    );

    startRealPlayers();

    // The real match (one artificially slow opening turn, everything else at full
    // `local`-brain speed) plays out to a genuine decision.
    await page.waitForFunction(() => (window as unknown as { __pf: { matchEnded: boolean } }).__pf.matchEnded === true, null, {
      timeout: 20000,
      polling: 100
    });

    const events = await page.evaluate(() => (window as unknown as { __pf: { events: unknown[] } }).__pf.events);
    expect(events.length).toBeGreaterThan(0);

    const spectateLog = await page.evaluate(
      () => (window as unknown as { __pf: { spectateLog: unknown[] } }).__pf.spectateLog
    );
    expect(spectateLog.length).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('spectate wind-up pose holds through a real, slow compose — no timeout, no canned length', async ({
    page
  }) => {
    await page.goto(`/?spectate=${encodeURIComponent(origin)}&token=${token}&fast=1`);
    await page.waitForFunction(
      () => (window as unknown as { __pf: { selection: unknown } }).__pf.selection !== null,
      null,
      { polling: 100 }
    );

    const launchedAt = Date.now();
    startRealPlayers();

    // Wait for the wind-up to actually open (the `/thinking` POST + SSE round trip
    // is local-network fast, but not instant) before starting the "does it hold"
    // measurement below.
    await page.waitForFunction(
      () => (window as unknown as { __pf: { rigs: { p1: { pose: string } } | null } }).__pf.rigs?.p1.pose === 'windup',
      null,
      { timeout: 5000, polling: 50 }
    );

    // Poll well inside the real 2.5s compose delay and confirm the pose never
    // reverts on its own — proving there is no local timeout/fallback animation
    // driving it, only the eventual real `turn` snapshot.
    const deadline = launchedAt + SLOW_TURN_MS - 500;
    while (Date.now() < deadline) {
      const pose = await page.evaluate(
        () => (window as unknown as { __pf: { rigs: { p1: { pose: string } } | null } }).__pf.rigs?.p1.pose
      );
      expect(pose).toBe('windup');
      await page.waitForTimeout(150);
    }

    // ...and it DOES eventually resolve once the real turn actually lands.
    await page.waitForFunction(
      () => (window as unknown as { __pf: { rigs: { p1: { pose: string } } | null } }).__pf.rigs?.p1.pose !== 'windup',
      null,
      { timeout: 5000, polling: 100 }
    );
  });

  test('spectate causal ordering: every logged state change follows a real snapshot arrival, never reversed', async ({
    page
  }) => {
    await page.goto(`/?spectate=${encodeURIComponent(origin)}&token=${token}&fast=1`);
    await page.waitForFunction(
      () => (window as unknown as { __pf: { selection: unknown } }).__pf.selection !== null,
      null,
      { polling: 100 }
    );

    startRealPlayers();

    await page.waitForFunction(() => (window as unknown as { __pf: { matchEnded: boolean } }).__pf.matchEnded === true, null, {
      timeout: 20000,
      polling: 100
    });

    const spectateLog = await page.evaluate(
      () =>
        (window as unknown as { __pf: { spectateLog: { at: number; kind: string }[] } }).__pf.spectateLog
    );

    expect(spectateLog.length).toBeGreaterThan(0);
    // Monotonically non-decreasing timestamps — every entry was appended at the
    // moment its handler fired (a real snapshot arrival), never reordered or
    // backdated by a timer racing the network.
    for (let i = 1; i < spectateLog.length; i += 1) {
      expect(spectateLog[i]!.at).toBeGreaterThanOrEqual(spectateLog[i - 1]!.at);
    }
    // The very first thing that can ever happen to a fresh spectator is p1's
    // opening wind-up (the slow brain's `/thinking` POST fires before its
    // deliberately delayed `nextMessage` even resolves) — never a snapshot that
    // skipped straight to a landed turn.
    expect(spectateLog[0]!.kind).toBe('turnStart');
  });

  test('spectate readout label shows composing then landed, updated only by snapshot arrival', async ({
    page
  }) => {
    await page.goto(`/?spectate=${encodeURIComponent(origin)}&token=${token}&fast=1`);
    await page.waitForFunction(
      () => (window as unknown as { __pf: { selection: unknown } }).__pf.selection !== null,
      null,
      { polling: 100 }
    );

    startRealPlayers();

    const statusText = () => page.locator('#spectate-status').textContent();

    await expect
      .poll(statusText, { timeout: 5000, intervals: [100] })
      .toMatch(/composing/i);

    await expect
      .poll(statusText, { timeout: SLOW_TURN_MS + 5000, intervals: [150] })
      .toMatch(/landed/i);
  });
});
