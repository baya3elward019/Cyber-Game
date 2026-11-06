import { defineConfig } from 'vite';

// Relative base: works on https://USERNAME.github.io/REPOSITORY/ and locally.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  test: { environment: 'node' },
} as any);
