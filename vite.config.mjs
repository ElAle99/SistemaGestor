import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'frontend/dist', emptyOutDir: true,
    lib: { entry: resolve('frontend/catalog/main.jsx'), name: 'OrderCatalog', formats: ['iife'], fileName: () => 'order-catalog.js', cssFileName: 'order-catalog' },
    rollupOptions: {
      onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); },
      output: { assetFileNames: 'order-catalog.[ext]' }
    }
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }
});
