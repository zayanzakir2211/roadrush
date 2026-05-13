import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  publicDir: 'public',

  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },

  // rapier3d-compat bundles WASM as base64 — no plugin or special handling needed.
  // Excluding it from pre-bundling avoids Vite trying to transform it.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },

  worker: {
    format: 'es',
    // No plugins needed — compat build is plain JS + inlined WASM
  },

  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});