import { schema, t, type SchemaType } from '@colyseus/schema'

/**
 * Estado sincronizado de un jugador dentro de la sala.
 *
 * Se define con `schema()` + `t.*` (sin decoradores) para que la misma
 * definición sirva al servidor (que la instancia y muta) y al cliente (que la
 * decodifica), sin exigir `experimentalDecorators` en la toolchain de Vite.
 */
export const Player = schema(
  {
    /** Identificador de sesión Colyseus. Coincide con la clave en `players`. */
    sessionId: t.string(),
    /** Nombre visible. Por ahora lo asigna el servidor. */
    name: t.string(),
    x: t.number().default(0),
    y: t.number().default(0),
    /**
     * `false` mientras el servidor sostiene el asiento de un jugador cuya
     * conexión se cortó sin aviso, a la espera de que reconecte.
     */
    connected: t.boolean().default(true),
  },
  'Player',
)
export type Player = SchemaType<typeof Player>

export const OfficeState = schema(
  {
    players: t.map(Player),
  },
  'OfficeState',
)
export type OfficeState = SchemaType<typeof OfficeState>
