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
