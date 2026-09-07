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
    /** Nombre visible, elegido por el usuario (o `Invitado-xxxx`). */
    name: t.string(),
    /** Id del avatar (ver `AVATARS`). */
    avatar: t.string(),
    x: t.number().default(0),
    y: t.number().default(0),
    /** Hacia dónde mira: 'down' | 'up' | 'left' | 'right'. */
    dir: t.string().default('down'),
    /** `true` mientras camina; define la animación en los demás clientes. */
    moving: t.boolean().default(false),
    /** Ausente: por inactividad (automático) o fijado a mano. */
    away: t.boolean().default(false),
    /** `true` si el ausente lo fijó el usuario: solo se quita a mano. */
    awayManual: t.boolean().default(false),
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
