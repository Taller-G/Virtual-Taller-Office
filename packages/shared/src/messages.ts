import type { ChatRejection } from './chat'
import type { Direction } from './avatars'

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
