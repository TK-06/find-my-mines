import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Secrets live in the repo-root .env, not in this package.
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    // Point straight at the workspace source so editing shared types
    // hot-reloads without a separate build step.
    alias: {
      '@fmm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true, // listen on the LAN so a second laptop can reach the dev server
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
