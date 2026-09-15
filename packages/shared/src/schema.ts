import { schema, t, type SchemaType } from '@colyseus/schema'
import { DEFAULT_AGENT_TYPE } from './agents'

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
    /**
     * Who this is, across worlds. The session ends at every door — each world
     * is its own room — so anything that has to keep pointing at a person
     * after they travel (a meeting's invitees, its participants) names them by
     * this instead. The client mints one per browser tab and sends it when
     * joining; the server validates it (see `sanitizePersonId`).
     */
    personId: t.string().default(''),
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
    /**
     * How many agent mascots walk behind them. The server validates it on
     * joining (see `sanitizeAgentCount`); every client draws that many little
     * robots trailing this player. `default(0)` is what lets a client that
     * knows nothing about agents join a room that does.
     */
    agents: t.number().default(0),
    /**
     * What those mascots look like: an id from `AGENT_TYPES`, the same for all
     * of this player's agents. The server validates it on joining (see
     * `sanitizeAgentType`); `default` is the classic robot, which is what a
     * client that knows nothing about types draws and what an older client
     * joining a newer room is given.
     */
    agentType: t.string().default(DEFAULT_AGENT_TYPE),
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
    /**
     * Name of the seat they are sitting at (an object of class `seat` in the
     * map), or `''` if they are standing. It is the whole of the "focused"
     * state: there is no second flag to keep in step, whoever has a seat is
     * focused and the seat is taken. **Only the server writes it.**
     */
    seatId: t.string().default(''),
    /**
     * Id of the meeting they are in (key in `meetings`), or `''`. Being in a
     * meeting is not the same as being at a desk: it is its own status, it is
     * never swept to away, and it — not the distance to anybody — is what
     * decides the conversation they are in. **Only the server writes it.**
     */
    meetingId: t.string().default(''),
  },
  'Player',
)
export type Player = SchemaType<typeof Player>

/**
 * What a player is doing, as the people list and the avatar label show it.
 * The order is the precedence: someone whose connection dropped reads as
 * offline even if they were seated; being in a meeting beats being at a desk
 * (a participant holds a seat at the table, and "in the stand-up" says more
 * than "Focused"); and sitting down beats being away (the server frees the
 * seat when someone goes away, so the two never overlap).
 */
export type PlayerStatus = 'offline' | 'meeting' | 'focused' | 'away' | 'active'

export function playerStatus(player: {
  connected: boolean
  seatId: string
  meetingId: string
  away: boolean
}): PlayerStatus {
  if (!player.connected) return 'offline'
  if (player.meetingId !== '') return 'meeting'
  if (player.seatId !== '') return 'focused'
  return player.away ? 'away' : 'active'
}

/**
 * Visible text of each status, shared by the list and the avatar's badge. The
 * meeting one is the fallback: wherever the meeting's title is at hand, what
 * is shown is `In "Weekly"`.
 */
export const PLAYER_STATUS_TEXT: Record<PlayerStatus, string> = {
  offline: 'offline',
  meeting: 'In a meeting',
  focused: 'Focused',
  away: 'away',
  active: 'active',
}

/** Is the player heads-down at a desk? Conversations are off while they are. */
export function isFocused(player: { seatId: string }): boolean {
  return player.seatId !== ''
}

/** Is the player in a meeting? Their conversation is the meeting's, not the room's. */
export function isInMeeting(player: { meetingId: string }): boolean {
  return player.meetingId !== ''
}

/**
 * Is this person available to be pulled into a proximity bubble? Sitting at a
 * desk is heads-down, and being in a meeting is being in another conversation
 * already: in both cases walking past them starts nothing, in either
 * direction.
 */
export function isAvailableToTalkNearby(player: { seatId: string; meetingId: string }): boolean {
  return !isFocused(player) && !isInMeeting(player)
}

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
    /**
     * Id of the meeting this conversation **is**, or `''` for an ordinary
     * proximity bubble. A meeting's conversation is a bubble like any other as
     * far as the panel and the chat relay are concerned — which is the point —
     * but it is not decided by distance: nobody is absorbed into it by walking
     * past, no member falls out of it by sitting at the far end of the table,
     * and it lives until the meeting ends.
     */
    meetingId: t.string().default(''),
  },
  'Bubble',
)
export type Bubble = SchemaType<typeof Bubble>

/**
 * Somebody a meeting names: invited to it, or already inside it. The name
 * travels with the id because the people a meeting lists are not necessarily
 * in the room you are reading it from — the organiser may be sitting in the
 * First Office while you look at the list from the Chiron Office.
 */
export const MeetingPerson = schema(
  {
    /** Stable id of the person across worlds (see `Player.personId`). */
    personId: t.string(),
    /** Their visible name when they were invited or when they entered. */
    name: t.string(),
  },
  'MeetingPerson',
)
export type MeetingPerson = SchemaType<typeof MeetingPerson>

/**
 * A meeting: a title, a stretch of time, a room and the people invited.
 *
 * Meetings are the same in every world's room — one book of them on the
 * server, mirrored into each — so a meeting in the First Office is listed,
 * and can be entered, from the Chiron Office too. They only live in memory:
 * restarting the server empties the list.
 */
export const Meeting = schema(
  {
    /** Unique identifier. Matches the key in `meetings`. */
    id: t.string(),
    title: t.string(),
    /** Id of the world the room is in. */
    worldId: t.string(),
    /** Name of the meeting room (a zone marked `meeting` in that world's map). */
    room: t.string(),
    /** Start and end (epoch ms), the same number on every client. */
    startsAt: t.number(),
    endsAt: t.number(),
    /** `personId` of whoever scheduled it: the only one who can cancel it. */
    organiser: t.string(),
    /** Their visible name when they scheduled it. */
    organiserName: t.string(),
    /** Who may enter, the organiser included. Anybody else is turned away. */
    invited: t.array(MeetingPerson),
    /** Who is inside right now, in arrival order. */
    participants: t.array(MeetingPerson),
  },
  'Meeting',
)
export type Meeting = SchemaType<typeof Meeting>

/** A room a meeting can be booked into, as the scheduling form offers it. */
export const MeetingRoomInfo = schema(
  {
    worldId: t.string(),
    name: t.string(),
    /** How many seats its big table has: what "the table is full" means. */
    seats: t.number().default(0),
  },
  'MeetingRoomInfo',
)
export type MeetingRoomInfo = SchemaType<typeof MeetingRoomInfo>

export const OfficeState = schema(
  {
    players: t.map(Player),
    bubbles: t.map(Bubble),
    /**
     * Every meeting that has not ended, whichever world its room is in. The
     * same list in every room, so the panel shows it wherever you are
     * standing. A meeting leaves it the moment its end time passes or its
     * organiser cancels it.
     */
    meetings: t.map(Meeting),
    /** The rooms a meeting can be booked into, read off the worlds' maps. */
    meetingRooms: t.array(MeetingRoomInfo),
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
