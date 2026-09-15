/**
 * Server configuration read from environment variables.
 * `@colyseus/tools` loads `.env.development` / `.env.production` according to
 * NODE_ENV before this module is evaluated.
 */
function integer(name: string, fallback: number): number {
  return optionalInteger(name) ?? fallback
}

/** Integer >= 0 from the variable, or `undefined` if it is not defined. */
function optionalInteger(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`The environment variable ${name} must be a number >= 0 (got: "${raw}")`)
  }
  return value
}

/** Default radius of a bubble, in tiles (intimate conversation distance). */
export const DEFAULT_BUBBLE_RADIUS_TILES = 2

export const config = {
  port: integer('PORT', 2567),
  /** Maximum number of simultaneous players **per world**. */
  maxClients: integer('MAX_CLIENTS', 50),
  reconnectGraceSeconds: integer('RECONNECT_GRACE_SECONDS', 2),
  /** Seconds without activity after which a player becomes "away". */
  awayAfterSeconds: integer('AWAY_AFTER_SECONDS', 300),
  /**
   * Radius (px) of a conversation bubble. Empty = `DEFAULT_BUBBLE_RADIUS_TILES`
   * tiles of the loaded map (with 32 px tiles, 64 px).
   */
  bubbleRadiusPx: optionalInteger('BUBBLE_RADIUS_PX'),
  /** Maximum members per bubble; a full bubble absorbs nobody else. */
  bubbleMaxMembers: integer('BUBBLE_MAX_MEMBERS', 6),
  /** Cap of chat messages accepted per player within `chatRateWindowMs`. */
  chatMaxPerWindow: integer('CHAT_MAX_PER_WINDOW', 5),
  /** Window of the chat rate limit, in ms. */
  chatRateWindowMs: integer('CHAT_RATE_WINDOW_MS', 2000),
  /** Shortest gap between two waves from the same person, in ms. */
  waveCooldownMs: integer('WAVE_COOLDOWN_MS', 3000),
  pingIntervalMs: integer('PING_INTERVAL_MS', 2000),
  pingMaxRetries: integer('PING_MAX_RETRIES', 2),
  isProduction: process.env.NODE_ENV === 'production',
} as const
