import { defineConfig } from 'vite'

// Builds a single self-contained IIFE: parley-widget.js (styles are injected into a Shadow DOM at runtime).
export default defineConfig({
  build: {
    outDir: '../frontend/public/widget',
    emptyOutDir: false,
    lib: { entry: 'src/main.ts', name: 'ParleyWidget', formats: ['iife'], fileName: () => 'parley-widget.js' },
    minify: true,
    target: 'es2019',
  },
})
