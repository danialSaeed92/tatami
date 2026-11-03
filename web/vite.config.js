import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read the single root-level .env (only VITE_* variables reach the browser).
  envDir: '..',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
