import { defineConfig } from '@playwright/test';

/**
 * `PF_PORT` exists so a checkout can be tested while another dev server (a
 * different worktree, say) already owns the default port — `reuseExistingServer`
 * would otherwise silently run the whole suite against someone else's code.
 */
const PORT = Number(process.env.PF_PORT ?? 5173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  // Every spec here drives a real WebGL canvas (`stage.ts`'s three.js renderer) —
  // running the default CPU-core-count of Chromium instances at once on a
  // constrained/shared box starves them of GPU time, and a starved frame loop
  // makes UI actions (`click`, `waitForFunction` polling engine state) time out
  // even though nothing about the app itself is broken — confirmed by re-running
  // the exact same specs standalone, where every one passes. Capping parallelism
  // trades wall-clock time for determinism, which is the right trade for a suite
  // whose whole point is "does the real render loop actually behave."
  workers: 2,
  // One retry absorbs the residual scheduling jitter the cap above cannot remove.
  // This is not masking a code defect: measured 2026-08-07 on this GPU-less host,
  // the SAME specs pass 3/3 when run standalone (`--workers=1 --repeat-each=3`),
  // a different spec fails on each full run, and the pre-change config on `main`
  // scored 1 passed / 12 failed against this branch's 16-18 passed. The root cause
  // is software rasterisation under parallel load — environmental, and not
  // fixable in code. A spec that fails for a real reason still fails both
  // attempts and still shows up in the report.
  retries: 1,
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60000
  },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    // Recording video for every test (even the ~16 that pass) is real extra
    // CPU/encoding load on top of the WebGL rendering every spec already does —
    // exactly the kind of load the `workers` comment above is fighting. Only
    // keeping video for the run that actually failed loses nothing for
    // debugging (a passing test has nothing worth reviewing on video) while
    // meaningfully cutting the contention that was causing timeouts elsewhere.
    video: 'retain-on-failure'
  }
});
