import { defineConfig } from 'vite';
export default defineConfig({ build: {
  outDir: 'frontend/dist', emptyOutDir: false,
  lib: { entry: 'frontend/services/printerService.js', name: 'AllfixPrinter', formats: ['iife'], fileName: () => 'printer-service.js' }
} });
