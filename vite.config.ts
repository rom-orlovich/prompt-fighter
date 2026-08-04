/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base` matters only for the GitHub Pages deploy, where the site is served
// from /<repo-name>/ rather than the domain root.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/prompt-fighter/' : '/',
  build: { target: 'es2022' },
  // Vitest's default include glob would otherwise also pick up e2e/*.test.ts —
  // those are Playwright specs, run by `npx playwright test`, never by Vitest.
  test: {
    include: ['tests/**/*.test.ts']
  }
});
