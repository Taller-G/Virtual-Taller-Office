import type { ChatRejection } from './chat'
import type { Direction } from './avatars'

/**
 * Tipos de mensaje cliente <-> servidor. Se usan como claves en `room.send` /
 * `room.onMessage` en ambos lados, así un typo es error de compilación.
 */
export const Message = {
  /** Servidor -> cliente, una vez al entrar: metadatos de la sala. */
  ROOM_INFO: 'room_info',
  /** Cliente -> servidor: posición y animación de mi avatar (px en coordenadas del mapa). */
  MOVE: 'move',
  /** Cliente -> servidor: cambiar mi nombre visible. */
  SET_NAME: 'set_name',
  /** Cliente -> servidor: fijar o quitar el estado "ausente" a mano. */
  SET_AWAY: 'set_away',
  /** Cliente -> servidor: mandar un mensaje a mi burbuja de conversación. */
  CHAT_SEND: 'chat_send',
  /**
   * Servidor -> cliente: un mensaje de la burbuja. Solo lo reciben los
   * miembros que la burbuja del remitente tenía en ese instante, el remitente
   * incluido: ese eco es el acuse de "enviado" y trae la hora del servidor.
   */
  CHAT_MESSAGE: 'chat_message',
  /** Servidor -> remitente: el mensaje no se aceptó (con el motivo). */
  CHAT_ERROR: 'chat_error',
} as const

export type MessageType = (typeof Message)[keyof typeof Message]

export interface RoomInfoPayload {
  roomId: string
  name: string
  /** Identificador de sesión asignado al cliente que recibe el mensaje. */
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
  /** Id que elige el cliente para reconocer el eco de su propio mensaje. */
  id: string
  text: string
}

export interface ChatMessagePayload {
  id: string
  /** Burbuja en la que se dijo; el cliente descarta lo que no sea la suya. */
  bubbleId: string
  /** sessionId del autor. */
  from: string
  /** Nombre visible del autor al momento de mandarlo. */
  name: string
  text: string
  /** Hora del servidor (epoch ms): la misma para todos los que lo reciben. */
  at: number
}

export interface ChatErrorPayload {
  id: string
  reason: ChatRejection
}
