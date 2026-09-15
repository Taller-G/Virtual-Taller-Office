import type { ChatRejection } from './chat'
import type { Direction } from './avatars'
import type { MeetingDraft, MeetingRejection } from './meetings'

/**
 * Client <-> server message types. They are used as keys in `room.send` /
 * `room.onMessage` on both sides, so a typo is a compile error.
 */
export const Message = {
  /** Server -> client, once on join: room metadata. */
  ROOM_INFO: 'room_info',
  /** Client -> server: position and animation of my avatar (px in map coordinates). */
  MOVE: 'move',
  /** Client -> server: change my visible name. */
  SET_NAME: 'set_name',
  /** Client -> server: set or clear the "away" state by hand. */
  SET_AWAY: 'set_away',
  /**
   * Client -> server: sit down at a seat of the map (an object of class
   * `seat`). The server decides: it refuses a seat that does not exist or is
   * already taken, and whoever sits is "focused" until they stand up.
   */
  SIT: 'sit',
  /** Client -> server: stand up from wherever I am sitting. */
  STAND: 'stand',
  /** Client -> server: send a message to my conversation bubble. */
  CHAT_SEND: 'chat_send',
  /**
   * Server -> client: a message from the bubble. Only the members the
   * sender's bubble had at that instant receive it, the sender included: that
   * echo is the "sent" acknowledgement and carries the server's timestamp.
   */
  CHAT_MESSAGE: 'chat_message',
  /** Server -> sender: the message was not accepted (with the reason). */
  CHAT_ERROR: 'chat_error',
  /**
   * Client -> server: wave at somebody. Unlike chat it needs no bubble - a
   * wave is how you get the attention of someone across the room, so it works
   * at any distance, to anyone in the same world.
   */
  WAVE_SEND: 'wave_send',
  /** Server -> the person waved at: somebody waved. */
  WAVE: 'wave',
  /** Client -> server: schedule a meeting (title, time, room, invitees). */
  MEETING_SCHEDULE: 'meeting_schedule',
  /** Client -> server: cancel a meeting I am the organiser of. */
  MEETING_CANCEL: 'meeting_cancel',
  /**
   * Client -> server: enter a meeting. The server decides everything about
   * it: whether I was invited, whether it is open, and where in the room I end
   * up. A refusal comes back as `MEETING_ERROR` and leaves me where I was.
   */
  MEETING_ENTER: 'meeting_enter',
  /** Client -> server: leave the meeting I am in. */
  MEETING_LEAVE: 'meeting_leave',
  /** Server -> the one who asked: the meeting action was not accepted, and why. */
  MEETING_ERROR: 'meeting_error',
  /**
   * Server -> the participants: the meeting they were in is over, because the
   * end time came or because the organiser cancelled it. The state says the
   * same thing (the meeting is gone), but not *why*, and being tipped out of a
   * conversation without a word is the thing to avoid.
   */
  MEETING_ENDED: 'meeting_ended',
} as const

export type MessageType = (typeof Message)[keyof typeof Message]

export interface RoomInfoPayload {
  roomId: string
  /** Id of the world this room hosts (see `worlds.ts`). */
  worldId: string
  /** Visible name of the world. */
  name: string
  /** Session identifier assigned to the client receiving the message. */
  sessionId: string
}

export interface MovePayload {
  x: number
  y: number
  dir: Direction
  moving: boolean
}

export interface SetNamePayload {
  name: string
}

export interface SetAwayPayload {
  away: boolean
}

export interface SitPayload {
  /** Name of the seat in the map (see `Seat`). */
  seat: string
}

export interface WaveSendPayload {
  /** sessionId of whoever the wave is for. */
  to: string
}

export interface WavePayload {
  /** sessionId of whoever waved. */
  from: string
  /** Their visible name at the moment they waved. */
  name: string
}

export interface ChatSendPayload {
  /** Id chosen by the client to recognise the echo of its own message. */
  id: string
  text: string
}

export interface ChatMessagePayload {
  id: string
  /** Bubble it was said in; the client discards anything that is not its own. */
  bubbleId: string
  /** sessionId of the author. */
  from: string
  /** Visible name of the author at the time of sending. */
  name: string
  text: string
  /** Server time (epoch ms): the same for everyone who receives it. */
  at: number
}

export interface ChatErrorPayload {
  id: string
  reason: ChatRejection
}

/** What a client sends to schedule a meeting (see `MeetingDraft`). */
export type MeetingSchedulePayload = MeetingDraft

export interface MeetingActionPayload {
  /** Id of the meeting to cancel, enter or leave. */
  meetingId: string
}

export interface MeetingErrorPayload {
  reason: MeetingRejection
  /**
   * For `room_conflict`: the meeting already holding that room. The panel
   * names it and its time in the reader's own time zone — the server's is
   * nobody's.
   */
  conflict?: { title: string; startsAt: number; endsAt: number }
}

export interface MeetingEndedPayload {
  meetingId: string
  title: string
  /** `cancelled` while it was still running, `ended` when its time was up. */
  reason: 'cancelled' | 'ended'
}
