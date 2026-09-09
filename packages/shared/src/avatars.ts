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
 *
 * `persona1`, `persona2` y `persona3` son los avatares del equipo de Taller,
 * derivados de los sprites base (lucy/nancy/ash) recoloreando pelo y ropa para
 * conservar los rasgos de cada persona real; se generan con
 * `tools/person-avatars.py`. Renombrá sus labels cuando tengas los nombres.
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
  { id: 'persona1', label: 'Persona 1' },
  { id: 'persona2', label: 'Persona 2' },
  { id: 'persona3', label: 'Persona 3' },
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

// ---------------------------------------------------------------------------
// Composable appearance (layered avatars)
// ---------------------------------------------------------------------------

/** Bases disponibles para avatares compuestos (los 4 originales de LimeZu). */
export const APPEARANCE_BASES = ['adam', 'ash', 'lucy', 'nancy'] as const
export type AppearanceBase = (typeof APPEARANCE_BASES)[number]

export const SKIN_TONES = ['default', 'light', 'medium', 'tan', 'dark'] as const
export type SkinTone = (typeof SKIN_TONES)[number]

export const HAT_OPTIONS = ['none', 'cap', 'beanie'] as const
export type HatOption = (typeof HAT_OPTIONS)[number]

export const GLASSES_OPTIONS = ['none', 'glasses-round', 'glasses-square'] as const
export type GlassesOption = (typeof GLASSES_OPTIONS)[number]

/**
 * Paleta de colores nombrados para pelo y ropa.  Cada entrada es un tint hex
 * que Phaser aplica sobre la capa en escala de grises con `setTint()`.
 *
 * 0xFFFFFF = sin teñir (conserva el gris original como color neutro).
 */
export const HAIR_COLORS = {
  black: 0x3a3a4a,
  brown: 0x8b6040,
  auburn: 0xa04830,
  blonde: 0xe8c860,
  red: 0xd04040,
  blue: 0x4080d0,
  green: 0x40a060,
  pink: 0xd060a0,
  white: 0xe0e0e8,
  purple: 0x9060c0,
} as const

export const HAIR_COLOR_IDS = Object.keys(HAIR_COLORS) as readonly HairColorId[]
export type HairColorId = keyof typeof HAIR_COLORS

export const TOP_COLORS = {
  white: 0xf0f0f0,
  black: 0x3a3a4a,
  red: 0xd04040,
  blue: 0x4080d0,
  green: 0x40a060,
  yellow: 0xe0c840,
  purple: 0x9060c0,
  orange: 0xd08030,
  pink: 0xd060a0,
  gray: 0x909098,
} as const

export const TOP_COLOR_IDS = Object.keys(TOP_COLORS) as readonly TopColorId[]
export type TopColorId = keyof typeof TOP_COLORS

/**
 * Aspecto compuesto de un avatar: describe completamente cómo se ve un
 * personaje a partir de capas que se superponen.
 */
export interface Appearance {
  base: AppearanceBase
  skinTone: SkinTone
  hairColor: HairColorId
  topColor: TopColorId
  hat: HatOption
  glasses: GlassesOption
}

export const DEFAULT_APPEARANCE: Appearance = {
  base: 'adam',
  skinTone: 'default',
  hairColor: 'brown',
  topColor: 'green',
  hat: 'none',
  glasses: 'none',
}

/** Serializa un Appearance a JSON string para el campo del schema. */
export function serializeAppearance(a: Appearance): string {
  return JSON.stringify(a)
}

/** Deserializa un JSON string a Appearance, o devuelve null si es inválido. */
export function parseAppearance(raw: string): Appearance | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof obj !== 'object' ||
      obj === null ||
      !isAppearanceBase(obj.base) ||
      !isSkinTone(obj.skinTone) ||
      !isHairColorId(obj.hairColor) ||
      !isTopColorId(obj.topColor) ||
      !isHatOption(obj.hat) ||
      !isGlassesOption(obj.glasses)
    ) {
      return null
    }
    return {
      base: obj.base,
      skinTone: obj.skinTone,
      hairColor: obj.hairColor,
      topColor: obj.topColor,
      hat: obj.hat,
      glasses: obj.glasses,
    }
  } catch {
    return null
  }
}

/**
 * Valida y normaliza un string de apariencia.  Si es inválido devuelve string
 * vacío (= usar avatar preset en vez de compuesto).
 */
export function sanitizeAppearance(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  return parseAppearance(raw) !== null ? raw : ''
}

// Guardas de tipo
function isAppearanceBase(v: unknown): v is AppearanceBase {
  return typeof v === 'string' && (APPEARANCE_BASES as readonly string[]).includes(v)
}
function isSkinTone(v: unknown): v is SkinTone {
  return typeof v === 'string' && (SKIN_TONES as readonly string[]).includes(v)
}
function isHairColorId(v: unknown): v is HairColorId {
  return typeof v === 'string' && v in HAIR_COLORS
}
function isTopColorId(v: unknown): v is TopColorId {
  return typeof v === 'string' && v in TOP_COLORS
}
function isHatOption(v: unknown): v is HatOption {
  return typeof v === 'string' && (HAT_OPTIONS as readonly string[]).includes(v)
}
function isGlassesOption(v: unknown): v is GlassesOption {
  return typeof v === 'string' && (GLASSES_OPTIONS as readonly string[]).includes(v)
}
