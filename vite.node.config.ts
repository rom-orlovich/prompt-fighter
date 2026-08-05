import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist-node',
    emptyOutDir: true,
    rollupOptions: {
      input: { fight: 'src/cli/fight.ts' },
      output: { format: 'es', entryFileNames: '[name].mjs' }
    }
  }
});
