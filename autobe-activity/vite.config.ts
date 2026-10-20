import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Everything is bundled into a single HTML file so the PWA can be served from
  // any static host (or from disk) without any server-side routing.
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192
  },
  server: {
    host: true,
    port: 5173
  }
});