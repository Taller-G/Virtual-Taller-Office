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
    /** Id del avatar preset (ver `AVATARS`), usado cuando `appearance` está vacío. */
    avatar: t.string(),
    /**
     * Aspecto compuesto (JSON de `Appearance`).  Vacío = usar el preset
     * indicado por `avatar`.  Cuando tiene valor, el cliente lo interpreta
     * como capas superpuestas (body, hair, top, accesorios).
     */
    appearance: t.string().default(''),
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
    /**
     * Id de la burbuja de conversación en la que está (clave en `bubbles`), o
     * `''` si no está en ninguna. **Solo lo escribe el servidor**: no hay
     * mensaje para pedir ni forzar la pertenencia.
     */
    bubbleId: t.string().default(''),
  },
  'Player',
)
export type Player = SchemaType<typeof Player>

/**
 * Burbuja de conversación: el grupo de jugadores que quedaron a menos del
 * radio unos de otros. La decide el servidor (ver `apps/server/src/bubbles.ts`);
 * el cliente solo la dibuja y avisa.
 */
export const Bubble = schema(
  {
    /** Identificador único dentro de la sala. Coincide con la clave en `bubbles`. */
    id: t.string(),
    /** Centro de la burbuja: baricentro de sus miembros, recalculado al moverse. */
    x: t.number().default(0),
    y: t.number().default(0),
    /** sessionIds de los miembros, en orden de llegada. */
    members: t.array('string'),
  },
  'Bubble',
)
export type Bubble = SchemaType<typeof Bubble>

export const OfficeState = schema(
  {
    players: t.map(Player),
    bubbles: t.map(Bubble),
    /**
     * Parámetros con los que el servidor arma las burbujas, replicados para
     * que el cliente dibuje el radio real y detecte "llena" con los mismos
     * valores (configurables por variables de entorno del servidor).
     */
    bubbleRadius: t.number().default(0),
    bubbleMaxMembers: t.number().default(0),
  },
  'OfficeState',
)
export type OfficeState = SchemaType<typeof OfficeState>
