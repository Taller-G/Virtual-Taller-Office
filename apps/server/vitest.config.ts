import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Every file that uses `boot()` brings up a real Colyseus server on the
    // same port: if two run at once, the second fails with EADDRINUSE.
    fileParallelism: false,
    // Short grace period so the "disconnection without notice" test is fast.
    env: {
      RECONNECT_GRACE_SECONDS: '1',
      AWAY_AFTER_SECONDS: '1',
      PING_INTERVAL_MS: '500',
      PING_MAX_RETRIES: '2',
      // Bubbles: explicit radius and small cap to test "full" with few clients.
      BUBBLE_RADIUS_PX: '64',
      BUBBLE_MAX_MEMBERS: '3',
    },
  },
})
