import { DEFAULT_AVATAR, isAvatarId } from './avatars'

export const NAME_MAX_LENGTH = 20

/** Lo que el cliente manda como `options` al entrar a la sala de un mundo. */
export interface JoinOptions {
  name?: string
  avatar?: string
  /** JSON de `Appearance` (aspecto compuesto).  Vacío o ausente = usar preset. */
  appearance?: string
  /**
   * Nombre del spawn por el que se llega. Lo pone la puerta que se cruzó; sin
   * él se entra por el spawn de entrada del mundo.
   */
  spawn?: string
  /** Estado "ausente" con el que se viaja, para que cruzar una puerta no lo pierda. */
  away?: boolean
  /** `true` si ese ausente lo había fijado el usuario a mano. */
  awayManual?: boolean
}

/**
 * Normaliza un nombre visible: recorta espacios (incluidos los repetidos),
 * limita el largo y devuelve `undefined` si no queda nada usable. El servidor
 * decide el fallback (`Invitado-xxxx`).
 */
export function sanitizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim()
  return name.length > 0 ? name : undefined
}

/** Avatar válido del catálogo o el avatar por defecto. */
export function sanitizeAvatar(value: unknown): string {
  return isAvatarId(value) ? value : DEFAULT_AVATAR
}

export function guestName(sessionId: string): string {
  return `Invitado-${sessionId.slice(0, 4)}`
}
