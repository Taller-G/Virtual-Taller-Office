import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Cada archivo que usa `boot()` levanta un servidor Colyseus real en el
    // mismo puerto: si dos corren a la vez, el segundo falla con EADDRINUSE.
    fileParallelism: false,
    // Gracia corta para que la prueba de "desconexión sin aviso" sea rápida.
    env: {
      RECONNECT_GRACE_SECONDS: '1',
      AWAY_AFTER_SECONDS: '1',
      PING_INTERVAL_MS: '500',
      PING_MAX_RETRIES: '2',
      // Burbujas: radio explícito y tope chico para probar "llena" con pocos clientes.
      BUBBLE_RADIUS_PX: '64',
      BUBBLE_MAX_MEMBERS: '3',
    },
  },
})
