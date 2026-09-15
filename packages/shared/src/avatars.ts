/**
 * Catalogue of available avatars. Each id maps to a sprite sheet
 * `apps/client/public/assets/avatars/<id>.png` (32x48 px per frame, 52 frames)
 * with the layout of the LimeZu characters used by SkyOffice:
 *
 *   idle: right 0-5 - up 6-11 - left 12-17 - down 18-23
 *   walk: right 24-29 - up 30-35 - left 36-41 - down 42-47
 *   sit:  down 48 - left 49 - right 50 - up 51 (one frame each, see SIT_FRAME)
 *
 * The server validates the chosen avatar against this list; the client uses
 * it for the entry picker and to load the sheets.
 *
 * `persona1`, `persona2` and `persona3` are the Taller team's avatars,
 * derived from the base sprites (lucy/nancy/ash) by recolouring hair and
 * clothes so each real person's traits are kept; they are generated with
 * `tools/person-avatars.py`. Rename their labels once you have the names.
 */
export interface AvatarInfo {
  id: string
  /** Name shown in the picker. */
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
  { id: 'tomas', label: 'Tomas' },
  { id: 'persona1', label: 'Persona 1' },
  { id: 'persona2', label: 'Persona 2' },
  { id: 'persona3', label: 'Persona 3' },
]

export const AVATAR_IDS: readonly string[] = AVATARS.map((a) => a.id)
export const DEFAULT_AVATAR = AVATARS[0].id

export const AVATAR_FRAME = { width: 32, height: 48, count: 52 } as const

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** First frame of each animation in the sheet; each one has `FRAMES_PER_ANIM` frames. */
export const FRAMES_PER_ANIM = 6
export const ANIM_START: Record<'idle' | 'walk', Record<Direction, number>> = {
  idle: { right: 0, up: 6, left: 12, down: 18 },
  walk: { right: 24, up: 30, left: 36, down: 42 },
}

/**
 * Seated pose, one still frame per direction (the sheets have no seated
 * animation). They are the last four frames of the LimeZu layout; the
 * direction is the way the seated character faces, so a desk above its chair
 * means `down`.
 *
 * The composed-avatar layers (body, hair, top, accessories) carry the same
 * four frames, so a layered avatar sits down exactly like a preset one.
 */
export const SIT_FRAME: Record<Direction, number> = { down: 48, left: 49, right: 50, up: 51 }

export function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_IDS.includes(value)
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Composable appearance (layered avatars)
// ---------------------------------------------------------------------------

/** Bases available for composed avatars (the 4 originals from LimeZu). */
export const APPEARANCE_BASES = ['adam', 'ash', 'lucy', 'nancy'] as const
export type AppearanceBase = (typeof APPEARANCE_BASES)[number]

export const SKIN_TONES = ['default', 'light', 'medium', 'tan', 'dark'] as const
export type SkinTone = (typeof SKIN_TONES)[number]

export const HAT_OPTIONS = ['none', 'cap', 'beanie'] as const
export type HatOption = (typeof HAT_OPTIONS)[number]

export const GLASSES_OPTIONS = ['none', 'glasses-round', 'glasses-square'] as const
export type GlassesOption = (typeof GLASSES_OPTIONS)[number]

/**
 * Palette of named colours for hair and clothes.  Each entry is a hex tint
 * that Phaser applies over the greyscale layer with `setTint()`.
 *
 * 0xFFFFFF = untinted (keeps the original grey as a neutral colour).
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
 * Composed look of an avatar: fully describes how a character looks, built
 * from layers stacked on top of each other.
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

/** Serialises an Appearance to a JSON string for the schema field. */
export function serializeAppearance(a: Appearance): string {
  return JSON.stringify(a)
}

/** Parses a JSON string into an Appearance, or returns null if invalid. */
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
 * Validates and normalises an appearance string.  If it is invalid it returns
 * an empty string (= use a preset avatar instead of a composed one).
 */
export function sanitizeAppearance(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  return parseAppearance(raw) !== null ? raw : ''
}

// Type guards
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

// ---------------------------------------------------------------------------
// Layer stack of a composed appearance
// ---------------------------------------------------------------------------

/**
 * Sprite-sheet group the accessories live in — they are shared by every base,
 * unlike body/hair/top which are cut per base.
 */
export const ACCESSORY_GROUP = 'acc'

/** Untinted: the layer keeps the original colours of its sheet. */
export const NO_TINT = 0xffffff

/**
 * One layer of a composed avatar: which sheet to draw and the multiply tint
 * to apply over it.
 */
export interface AppearanceLayer {
  /** An `AppearanceBase` for the body parts, `ACCESSORY_GROUP` for accessories. */
  group: string
  /** `body`, `hair`, `top`, or the accessory's own id. */
  part: string
  /** Distinguishes the sheets of one part (the skin tone of a body). */
  variant?: string
  /** Colour multiplied over the greyscale sheet; `NO_TINT` leaves it alone. */
  tint: number
}

/**
 * The layers that make up an appearance, in the order they must be drawn
 * (first = furthest back).
 *
 * This is the single description of what a composed avatar is made of: the
 * in-game avatar builds Phaser sprites from it and the entry screen's preview
 * paints it on a canvas, so the two cannot disagree about which layers exist,
 * in which order, or with which colour. Adding a part to the catalogue means
 * adding it here, and both renderers pick it up.
 */
export function appearanceLayers(a: Appearance): AppearanceLayer[] {
  const layers: AppearanceLayer[] = [
    { group: a.base, part: 'body', variant: a.skinTone, tint: NO_TINT },
    { group: a.base, part: 'top', tint: TOP_COLORS[a.topColor] },
    { group: a.base, part: 'hair', tint: HAIR_COLORS[a.hairColor] },
  ]
  if (a.glasses !== 'none') layers.push({ group: ACCESSORY_GROUP, part: a.glasses, tint: NO_TINT })
  if (a.hat !== 'none') layers.push({ group: ACCESSORY_GROUP, part: a.hat, tint: NO_TINT })
  return layers
}

/**
 * Path of a layer's sprite sheet, relative to the folder holding them
 * (`assets/avatars/layers/`). Both the game's loader and the entry preview
 * resolve sheets through this, so a renamed file moves in one place.
 */
export function layerSheetFile(layer: Pick<AppearanceLayer, 'group' | 'part' | 'variant'>): string {
  const dir = layer.group === ACCESSORY_GROUP ? 'accessories' : layer.group
  const file = layer.variant ? `${layer.part}-${layer.variant}` : layer.part
  return `${dir}/${file}.png`
}

/**
 * Every layer sheet the catalogue can ask for, for preloading: all the bodies
 * (one per base and tone), hair and top of each base, and each accessory.
 */
export function allLayerSheets(): Pick<AppearanceLayer, 'group' | 'part' | 'variant'>[] {
  const sheets: Pick<AppearanceLayer, 'group' | 'part' | 'variant'>[] = []
  for (const base of APPEARANCE_BASES) {
    for (const tone of SKIN_TONES) sheets.push({ group: base, part: 'body', variant: tone })
    sheets.push({ group: base, part: 'hair' }, { group: base, part: 'top' })
  }
  for (const acc of [...HAT_OPTIONS, ...GLASSES_OPTIONS]) {
    if (acc === 'none') continue
    sheets.push({ group: ACCESSORY_GROUP, part: acc })
  }
  return sheets
}
