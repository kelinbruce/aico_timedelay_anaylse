import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/__nextagent/dev/workbench/',
  plugins: [react()],
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
});
