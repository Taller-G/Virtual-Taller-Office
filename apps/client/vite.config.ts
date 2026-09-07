import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // Si el puerto está ocupado, Vite toma el siguiente libre y lo informa.
    port: Number(process.env.VITE_PORT ?? 5173),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Phaser pesa ~1 MB minificado y se carga entero al inicio: el aviso de
    // tamaño de chunk no aporta nada aquí.
    chunkSizeWarningLimit: 1500,
  },
})
