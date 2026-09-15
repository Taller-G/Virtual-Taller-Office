import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_BASES,
  AVATAR_IDS,
  AVATARS,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  FACIAL_HAIR_OPTIONS,
  HAIR_STYLES,
  appearanceLayerAssets,
  appearanceLayers,
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
    expect(parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, hairColor: 'neon' }))).toBeNull()
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

  it('accepts every option of the parts added after the first editor', () => {
    for (const hairStyle of HAIR_STYLES) {
      for (const facialHair of FACIAL_HAIR_OPTIONS) {
        const a = { ...DEFAULT_APPEARANCE, hairStyle, facialHair }
        expect(parseAppearance(serializeAppearance(a))).toEqual(a)
      }
    }
    const legs = { ...DEFAULT_APPEARANCE, pantsColor: 'denim' as const, shoeColor: 'tan' as const }
    expect(parseAppearance(serializeAppearance(legs))).toEqual(legs)
  })

  it('loads an appearance saved before hair style, legs and facial hair existed', () => {
    const old = JSON.stringify({
      base: 'lucy',
      skinTone: 'tan',
      hairColor: 'pink',
      topColor: 'blue',
      hat: 'cap',
      glasses: 'none',
    })
    expect(parseAppearance(old)).toEqual({
      ...DEFAULT_APPEARANCE,
      base: 'lucy',
      skinTone: 'tan',
      hairColor: 'pink',
      topColor: 'blue',
      hat: 'cap',
    })
    expect(sanitizeAppearance(old)).toBe(old)
  })

  it('rejects an unknown value in the newer fields', () => {
    for (const field of ['hairStyle', 'facialHair', 'pantsColor', 'shoeColor']) {
      const raw = JSON.stringify({ ...DEFAULT_APPEARANCE, [field]: 'nope' })
      expect(parseAppearance(raw), field).toBeNull()
      expect(sanitizeAppearance(raw), field).toBe('')
    }
  })
})

describe('appearance layers', () => {
  it('stacks the parts in draw order', () => {
    const files = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      facialHair: 'beard',
      hat: 'cap',
      glasses: 'glasses-round',
      hairStyle: 'long',
    }).map((l) => l.file)
    expect(files).toEqual([
      'body-default',
      'shoes',
      'pants',
      'top',
      'facial-beard',
      'hair-long',
      'glasses-round',
      'cap',
    ])
  })

  it('leaves out the parts set to "none"', () => {
    const files = appearanceLayers(DEFAULT_APPEARANCE).map((l) => l.file)
    expect(files).toEqual(['body-default', 'shoes', 'pants', 'top', 'hair-short'])
  })

  it('tints the legs apart from each other and from the top', () => {
    const layers = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      topColor: 'red',
      pantsColor: 'blue',
      shoeColor: 'white',
    })
    const tint = (file: string) => layers.find((l) => l.file === file)?.tint
    expect(new Set([tint('top'), tint('pants'), tint('shoes')]).size).toBe(3)
    expect(tint('body-default')).toBeUndefined()
  })

  it('preloads a sheet for every layer any appearance can ask for', () => {
    const assets = appearanceLayerAssets()
    const keys = assets.map((r) => `${r.dir}/${r.file}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const base of APPEARANCE_BASES) {
      for (const style of HAIR_STYLES) expect(keys).toContain(`${base}/hair-${style}`)
      expect(keys).toContain(`${base}/pants`)
      expect(keys).toContain(`${base}/shoes`)
    }
    const used = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      base: 'nancy',
      facialHair: 'stubble',
      hat: 'beanie',
      glasses: 'glasses-square',
    })
    for (const layer of used) expect(keys).toContain(`${layer.dir}/${layer.file}`)
  })
})
