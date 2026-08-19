import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5299,
    proxy: { '/api': 'http://localhost:8899' },
  },
  build: { outDir: 'dist/client' },
});
