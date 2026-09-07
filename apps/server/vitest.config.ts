import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Gracia corta para que la prueba de "desconexión sin aviso" sea rápida.
    env: {
      RECONNECT_GRACE_SECONDS: '1',
      PING_INTERVAL_MS: '500',
      PING_MAX_RETRIES: '2',
    },
  },
})
