import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  // Serve both 'public' and 'cars-model' as static assets
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
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },

  worker: {
    format: 'es',
  },

  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Serve cars-model GLB files directly
    fs: {
      allow: ['..'],
    },
  },

  assetsInclude: ['**/*.glb'],
});