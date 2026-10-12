import { defineConfig } from 'vite';
export default defineConfig({ build: {
  outDir: 'frontend/dist', emptyOutDir: false,
  lib: { entry: 'frontend/services/shareTicketService.js', name: 'AllfixShareTicket', formats: ['iife'], fileName: () => 'share-ticket.js' }
} });
