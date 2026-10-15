import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so builds use a relative base.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', exclude: ['tests/e2e/**', 'node_modules/**'] },
} as any);
