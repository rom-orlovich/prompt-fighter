import { defineConfig } from 'vite';

// `base` matters only for the GitHub Pages deploy, where the site is served
// from /<repo-name>/ rather than the domain root.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/prompt-fighter/' : '/',
  build: { target: 'es2022' }
});
