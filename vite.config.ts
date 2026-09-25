import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5199,
    strictPort: true
  }
});
