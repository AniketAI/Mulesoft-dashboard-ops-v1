
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Extend proxy timeout to handle long-running ping tests
        // (worst case: 12 paths × 30s each = 6 min; plus client 95s safety cutoff)
        proxyTimeout: 120000,   // 2 minutes — covers 95s client timeout + backend overhead
        timeout: 120000,
      }
    }
  },
  build: {
    sourcemap: false
  },
  optimizeDeps: {
    exclude: ['@remix-run/router']
  }
});