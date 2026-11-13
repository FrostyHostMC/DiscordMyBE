import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => ({
  server: {
    host: '::',
    port: 8080
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
      deleteInlinedFiles: true
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  build: {
    sourcemap: false,
    minify: true,
  },
}));
