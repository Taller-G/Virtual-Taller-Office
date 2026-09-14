import { schema, t, type SchemaType } from '@colyseus/schema'

/**
 * Synchronised state of a player inside the room.
 *
 * It is defined with `schema()` + `t.*` (no decorators) so that the same
 * definition serves the server (which instantiates and mutates it) and the
 * client (which decodes it), without requiring `experimentalDecorators` in
 * Vite's toolchain.
 */
export const Player = schema(
  {
    /** Colyseus session identifier. Matches the key in `players`. */
    sessionId: t.string(),
    /** Visible name, chosen by the user (or `Guest-xxxx`). */
    name: t.string(),
    /** Id of the preset avatar (see `AVATARS`), used when `appearance` is empty. */
    avatar: t.string(),
    /**
     * Composed appearance (JSON of `Appearance`).  Empty = use the preset
     * named by `avatar`.  When it has a value, the client reads it as
     * stacked layers (body, hair, top, accessories).
     */
    appearance: t.string().default(''),
    x: t.number().default(0),
    y: t.number().default(0),
    /** Which way it faces: 'down' | 'up' | 'left' | 'right'. */
    dir: t.string().default('down'),
    /** `true` while walking; defines the animation on the other clients. */
    moving: t.boolean().default(false),
    /** Away: through inactivity (automatic) or set by hand. */
    away: t.boolean().default(false),
    /** `true` if the user set the away state by hand: only cleared by hand. */
    awayManual: t.boolean().default(false),
    /**
     * `false` while the server holds the seat of a player whose connection
     * dropped without notice, waiting for them to reconnect.
     */
    connected: t.boolean().default(true),
    /**
     * Id of the conversation bubble they are in (key in `bubbles`), or `''`
     * if they are in none. **Only the server writes it**: there is no message
     * to request or force membership.
     */
    bubbleId: t.string().default(''),
  },
  'Player',
)
export type Player = SchemaType<typeof Player>

/**
 * Conversation bubble: the group of players who ended up within the radius of
 * one another. The server decides it (see `apps/server/src/bubbles.ts`); the
 * client only draws it and announces it.
 */
export const Bubble = schema(
  {
    /** Unique identifier within the room. Matches the key in `bubbles`. */
    id: t.string(),
    /** Centre of the bubble: centroid of its members, recomputed as they move. */
    x: t.number().default(0),
    y: t.number().default(0),
    /** sessionIds of the members, in arrival order. */
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
     * Parameters the server builds bubbles with, replicated so that the
     * client draws the real radius and detects "full" with the same values
     * (configurable through the server's environment variables).
     */
    bubbleRadius: t.number().default(0),
    bubbleMaxMembers: t.number().default(0),
  },
  'OfficeState',
)
export type OfficeState = SchemaType<typeof OfficeState>
