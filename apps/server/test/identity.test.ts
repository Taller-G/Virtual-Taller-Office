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

describe('avatar catalogue', () => {
  it('offers exactly 11 avatars with unique ids', () => {
    expect(AVATARS).toHaveLength(11)
    expect(new Set(AVATAR_IDS).size).toBe(11)
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR)
  })

  it('sanitizeAvatar accepts only ids from the catalogue', () => {
    for (const id of AVATAR_IDS) expect(sanitizeAvatar(id)).toBe(id)
    expect(sanitizeAvatar('nope')).toBe(DEFAULT_AVATAR)
    expect(sanitizeAvatar(undefined)).toBe(DEFAULT_AVATAR)
    expect(sanitizeAvatar(3)).toBe(DEFAULT_AVATAR)
  })

  it('isDirection recognises the four directions', () => {
    expect(['up', 'down', 'left', 'right'].every(isDirection)).toBe(true)
    expect(isDirection('diagonal')).toBe(false)
    expect(isDirection(undefined)).toBe(false)
  })
})

describe('sanitizeName', () => {
  it('trims whitespace and caps the length', () => {
    expect(sanitizeName('  Ana   Lopez ')).toBe('Ana Lopez')
    expect(sanitizeName('a'.repeat(50))).toHaveLength(NAME_MAX_LENGTH)
    expect(sanitizeName('ab\n\tcd')).toBe('ab cd')
  })

  it('returns undefined when nothing usable is left', () => {
    expect(sanitizeName('')).toBeUndefined()
    expect(sanitizeName('    ')).toBeUndefined()
    expect(sanitizeName(undefined)).toBeUndefined()
    expect(sanitizeName(123)).toBeUndefined()
  })
})

describe('appearance', () => {
  it('serialises and parses back correctly', () => {
    const raw = serializeAppearance(DEFAULT_APPEARANCE)
    const parsed = parseAppearance(raw)
    expect(parsed).toEqual(DEFAULT_APPEARANCE)
  })

  it('rejects invalid appearances', () => {
    expect(parseAppearance('')).toBeNull()
    expect(parseAppearance('not json')).toBeNull()
    expect(parseAppearance('{"base":"invalid"}')).toBeNull()
    expect(parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, base: 'nope' }))).toBeNull()
    expect(
      parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, hairColor: 'neon' })),
    ).toBeNull()
  })

  it('sanitizeAppearance passes valid JSON through and rejects junk', () => {
    const valid = serializeAppearance(DEFAULT_APPEARANCE)
    expect(sanitizeAppearance(valid)).toBe(valid)
    expect(sanitizeAppearance('')).toBe('')
    expect(sanitizeAppearance(undefined)).toBe('')
    expect(sanitizeAppearance('broken')).toBe('')
    expect(sanitizeAppearance(123)).toBe('')
  })

  it('accepts every combination of options', () => {
    const a = { ...DEFAULT_APPEARANCE, hat: 'beanie' as const, glasses: 'glasses-round' as const }
    const raw = serializeAppearance(a)
    expect(parseAppearance(raw)).toEqual(a)
  })

  it('accepts "none" accessories', () => {
    const a = { ...DEFAULT_APPEARANCE, hat: 'none' as const, glasses: 'none' as const }
    const raw = serializeAppearance(a)
    expect(parseAppearance(raw)).toEqual(a)
  })
})
