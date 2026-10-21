import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath, URL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
/** IMPORTANT: DO NOT REMOVE THIS LINE */
import { aippyTaggerPlugin, aippyPreloadPlugin, assetConstantsPlugin } from '@aippy/vite-plugins';

export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 5173
  },
  // IMPORTANT: DO NOT REMOVE THIS THREE PLUGINS
  plugins: [
    react(),
    tailwindcss(),
    // Development only: asset constants plugin
    mode === 'development' && assetConstantsPlugin({
      extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp4', '.mp3', '.wav', '.ogg', '.webm'],
      srcDir: 'src',
      outputFile: 'src/config/assets.json',
      devMode: true
    }),
    // Development only: component tagging for inspector
    mode === 'development' && aippyTaggerPlugin(),
    // bundle optimization
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
      deleteInlinedFiles: false // Keep codebase-archive.zip for download
    }),
    // asset preload for aippy app (scans source files)
    aippyPreloadPlugin({
      extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav', '.ogg', '.webm', '.task', '.tflite'],
      srcDir: 'src',
      outDir: 'dist',
      deepScan: true
    }),
    // Remove inspector script in production
    mode === 'production' && {
      name: 'remove-inspector-script',
      transformIndexHtml(html: string) {
        return html.replace(
          /<!-- Inspector script for iframe editing mode -->[\s\S]*?<!-- Inspector script end -->/,
          ''
        );
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
    sourcemap: mode === 'development',
    minify: mode === 'production',
    copyPublicDir: true, // Ensure public folder is copied to dist
  },
}));
