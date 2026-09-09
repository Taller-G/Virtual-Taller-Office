import { describe, expect, it } from 'vitest'
import {
  AVATAR_IDS,
  AVATARS,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  isDirection,
  NAME_MAX_LENGTH,
  parseAppearance,
  sanitizeAppearance,
  sanitizeAvatar,
  sanitizeName,
  serializeAppearance,
} from '@vto/shared'

describe('catálogo de avatares', () => {
  it('ofrece exactamente 11 avatares con ids únicos', () => {
    expect(AVATARS).toHaveLength(11)
    expect(new Set(AVATAR_IDS).size).toBe(11)
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR)
  })

  it('sanitizeAvatar acepta solo ids del catálogo', () => {
    for (const id of AVATAR_IDS) expect(sanitizeAvatar(id)).toBe(id)
    expect(sanitizeAvatar('nope')).toBe(DEFAULT_AVATAR)
    expect(sanitizeAvatar(undefined)).toBe(DEFAULT_AVATAR)
    expect(sanitizeAvatar(3)).toBe(DEFAULT_AVATAR)
  })

  it('isDirection reconoce las cuatro direcciones', () => {
    expect(['up', 'down', 'left', 'right'].every(isDirection)).toBe(true)
    expect(isDirection('diagonal')).toBe(false)
    expect(isDirection(undefined)).toBe(false)
  })
})

describe('sanitizeName', () => {
  it('recorta espacios y limita el largo', () => {
    expect(sanitizeName('  Ana   López ')).toBe('Ana López')
    expect(sanitizeName('a'.repeat(50))).toHaveLength(NAME_MAX_LENGTH)
    expect(sanitizeName('ab\n\tcd')).toBe('ab cd')
  })

  it('devuelve undefined si no queda nada usable', () => {
    expect(sanitizeName('')).toBeUndefined()
    expect(sanitizeName('    ')).toBeUndefined()
    expect(sanitizeName(undefined)).toBeUndefined()
    expect(sanitizeName(123)).toBeUndefined()
  })
})

describe('appearance', () => {
  it('serializa y deserializa correctamente', () => {
    const raw = serializeAppearance(DEFAULT_APPEARANCE)
    const parsed = parseAppearance(raw)
    expect(parsed).toEqual(DEFAULT_APPEARANCE)
  })

  it('rechaza apariencias inválidas', () => {
    expect(parseAppearance('')).toBeNull()
    expect(parseAppearance('not json')).toBeNull()
    expect(parseAppearance('{"base":"invalid"}')).toBeNull()
    expect(parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, base: 'nope' }))).toBeNull()
    expect(
      parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, hairColor: 'neon' })),
    ).toBeNull()
  })

  it('sanitizeAppearance pasa un JSON válido y rechaza basura', () => {
    const valid = serializeAppearance(DEFAULT_APPEARANCE)
    expect(sanitizeAppearance(valid)).toBe(valid)
    expect(sanitizeAppearance('')).toBe('')
    expect(sanitizeAppearance(undefined)).toBe('')
    expect(sanitizeAppearance('broken')).toBe('')
    expect(sanitizeAppearance(123)).toBe('')
  })

  it('acepta todas las combinaciones de opciones', () => {
    const a = { ...DEFAULT_APPEARANCE, hat: 'beanie' as const, glasses: 'glasses-round' as const }
    const raw = serializeAppearance(a)
    expect(parseAppearance(raw)).toEqual(a)
  })

  it('acepta accesorios "none"', () => {
    const a = { ...DEFAULT_APPEARANCE, hat: 'none' as const, glasses: 'none' as const }
    const raw = serializeAppearance(a)
    expect(parseAppearance(raw)).toEqual(a)
  })
})
