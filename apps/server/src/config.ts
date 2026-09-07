/**
 * Configuración del servidor leída de variables de entorno.
 * `@colyseus/tools` carga `.env.development` / `.env.production` según NODE_ENV
 * antes de que este módulo se evalúe.
 */
function integer(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`La variable de entorno ${name} debe ser un número >= 0 (recibido: "${raw}")`)
  }
  return value
}

export const config = {
  port: integer('PORT', 2567),
  maxClients: integer('MAX_CLIENTS', 50),
  reconnectGraceSeconds: integer('RECONNECT_GRACE_SECONDS', 2),
  pingIntervalMs: integer('PING_INTERVAL_MS', 2000),
  pingMaxRetries: integer('PING_MAX_RETRIES', 2),
  isProduction: process.env.NODE_ENV === 'production',
} as const
