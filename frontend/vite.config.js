import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'],
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer / WASM threading
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
