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
    rollupOptions: {
      output: {
        // Libraries in their own chunks: the app chunk stays under Vite's
        // 500 kB warning, and a release that only changes game code leaves
        // these cached in the browser.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase';
          if (/[\\/]node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)[\\/]/.test(id)) {
            return 'socket';
          }
          return undefined;
        },
      },
    },
  },
});
