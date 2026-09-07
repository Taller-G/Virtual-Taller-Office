/**
 * Catálogo de avatares disponibles. Cada id corresponde a una hoja de sprites
 * `apps/client/public/assets/avatars/<id>.png` (32×48 px por frame, 52 frames)
 * con el layout de los personajes de LimeZu usado por SkyOffice:
 *
 *   idle: right 0-5 · up 6-11 · left 12-17 · down 18-23
 *   walk: right 24-29 · up 30-35 · left 36-41 · down 42-47
 *   (48-51: sentado, no se usa todavía)
 *
 * El servidor valida el avatar elegido contra esta lista; el cliente la usa
 * para el selector de entrada y para cargar las hojas.
 */
export interface AvatarInfo {
  id: string
  /** Nombre que se muestra en el selector. */
  label: string
}

export const AVATARS: readonly AvatarInfo[] = [
  { id: 'adam', label: 'Adam' },
  { id: 'ash', label: 'Ash' },
  { id: 'lucy', label: 'Lucy' },
  { id: 'nancy', label: 'Nancy' },
  { id: 'bruno', label: 'Bruno' },
  { id: 'dana', label: 'Dana' },
  { id: 'iris', label: 'Iris' },
  { id: 'tomas', label: 'Tomás' },
]

export const AVATAR_IDS: readonly string[] = AVATARS.map((a) => a.id)
export const DEFAULT_AVATAR = AVATARS[0].id

export const AVATAR_FRAME = { width: 32, height: 48, count: 52 } as const

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** Primer frame de cada animación en la hoja; cada una tiene `FRAMES_PER_ANIM` frames. */
export const FRAMES_PER_ANIM = 6
export const ANIM_START: Record<'idle' | 'walk', Record<Direction, number>> = {
  idle: { right: 0, up: 6, left: 12, down: 18 },
  walk: { right: 24, up: 30, left: 36, down: 42 },
}

export function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_IDS.includes(value)
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)
}
