import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  root: 'web', plugins: [react(), tailwind()], build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787', changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Preserve the production same-origin check across the two local dev ports.
            if (incoming.headers.origin === 'http://127.0.0.1:5173') outgoing.setHeader('Origin', 'http://127.0.0.1:8787');
          });
        }
      }
    }
  }
});
