import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // If the port is taken, Vite picks the next free one and reports it.
    port: Number(process.env.VITE_PORT ?? 5173),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Phaser weighs ~1 MB minified and is loaded whole at startup: the chunk
    // size warning adds nothing here.
    chunkSizeWarningLimit: 1500,
  },
})
