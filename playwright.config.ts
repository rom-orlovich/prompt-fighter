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
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60000
  },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    video: 'on'
  }
});
