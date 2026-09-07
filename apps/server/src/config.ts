/**
 * Configuración del servidor leída de variables de entorno.
 * `@colyseus/tools` carga `.env.development` / `.env.production` según NODE_ENV
 * antes de que este módulo se evalúe.
 */
function integer(name: string, fallback: number): number {
  return optionalInteger(name) ?? fallback
}

/** Entero >= 0 de la variable, o `undefined` si no está definida. */
function optionalInteger(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`La variable de entorno ${name} debe ser un número >= 0 (recibido: "${raw}")`)
  }
  return value
}

/** Tiles de radio por defecto de una burbuja (distancia de conversación íntima). */
export const DEFAULT_BUBBLE_RADIUS_TILES = 2

export const config = {
  port: integer('PORT', 2567),
  /** Ruta al mapa Tiled JSON. Vacío = el mapa que sirve el cliente (ver map.ts). */
  mapFile: process.env.MAP_FILE || undefined,
  maxClients: integer('MAX_CLIENTS', 50),
  reconnectGraceSeconds: integer('RECONNECT_GRACE_SECONDS', 2),
  /** Segundos sin actividad tras los cuales un jugador pasa a "ausente". */
  awayAfterSeconds: integer('AWAY_AFTER_SECONDS', 300),
  /**
   * Radio (px) de una burbuja de conversación. Vacío = `DEFAULT_BUBBLE_RADIUS_TILES`
   * tiles del mapa cargado (con tiles de 32 px, 64 px).
   */
  bubbleRadiusPx: optionalInteger('BUBBLE_RADIUS_PX'),
  /** Máximo de miembros por burbuja; una burbuja llena no absorbe a nadie más. */
  bubbleMaxMembers: integer('BUBBLE_MAX_MEMBERS', 6),
  /** Tope de mensajes de chat aceptados por jugador en `chatRateWindowMs`. */
  chatMaxPerWindow: integer('CHAT_MAX_PER_WINDOW', 5),
  /** Ventana del tope de ritmo del chat, en ms. */
  chatRateWindowMs: integer('CHAT_RATE_WINDOW_MS', 2000),
  pingIntervalMs: integer('PING_INTERVAL_MS', 2000),
  pingMaxRetries: integer('PING_MAX_RETRIES', 2),
  isProduction: process.env.NODE_ENV === 'production',
} as const
