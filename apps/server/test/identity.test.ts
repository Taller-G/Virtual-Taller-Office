import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENT_TYPES,
  AGENT_TYPE_IDS,
  APPEARANCE_BASES,
  AVATAR_IDS,
  AVATARS,
  DEFAULT_AGENTS,
  DEFAULT_AGENT_TYPE,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  FACIAL_HAIR_OPTIONS,
  HAIR_STYLES,
  NO_TINT,
  allLayerSheets,
  appearanceLayers,
  layerSheetFile,
  isDirection,
  MAX_AGENTS,
  NAME_MAX_LENGTH,
  parseAppearance,
  sanitizeAgentCount,
  sanitizeAgentType,
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
    const sheets = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      facialHair: 'beard',
      hat: 'cap',
      glasses: 'glasses-round',
      hairStyle: 'long',
    }).map(layerSheetFile)
    expect(sheets).toEqual([
      'adam/body-default.png',
      'adam/shoes.png',
      'adam/pants.png',
      'adam/top.png',
      'adam/facial-beard.png',
      'adam/hair-long.png',
      'adam/glasses-round.png',
      'adam/cap.png',
    ])
  })

  it('leaves out the parts set to "none"', () => {
    const sheets = appearanceLayers(DEFAULT_APPEARANCE).map(layerSheetFile)
    expect(sheets).toEqual([
      'adam/body-default.png',
      'adam/shoes.png',
      'adam/pants.png',
      'adam/top.png',
      'adam/hair-short.png',
    ])
  })

  it('tints the legs apart from each other and from the top', () => {
    const layers = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      topColor: 'red',
      pantsColor: 'blue',
      shoeColor: 'white',
    })
    const tint = (part: string) => layers.find((l) => l.part === part)?.tint
    expect(new Set([tint('top'), tint('pants'), tint('shoes')]).size).toBe(3)
    expect(tint('body')).toBe(NO_TINT)
  })

  it('preloads a sheet for every layer any appearance can ask for', () => {
    const sheets = allLayerSheets().map(layerSheetFile)
    expect(new Set(sheets).size).toBe(sheets.length)
    for (const base of APPEARANCE_BASES) {
      for (const style of HAIR_STYLES) expect(sheets).toContain(`${base}/hair-${style}.png`)
      expect(sheets).toContain(`${base}/pants.png`)
      expect(sheets).toContain(`${base}/shoes.png`)
      // Accessories are cut per silhouette too: a hat is measured against the
      // skull it sits on, so there is no sheet shared between the four bases.
      expect(sheets).toContain(`${base}/cap.png`)
      expect(sheets).toContain(`${base}/beanie.png`)
      expect(sheets).toContain(`${base}/glasses-round.png`)
      expect(sheets).toContain(`${base}/glasses-square.png`)
    }
    const used = appearanceLayers({
      ...DEFAULT_APPEARANCE,
      base: 'nancy',
      facialHair: 'stubble',
      hat: 'beanie',
      glasses: 'glasses-square',
    })
    for (const layer of used) expect(sheets).toContain(layerSheetFile(layer))
  })

  it('has a file on disk for every sheet it preloads', () => {
    // The catalogue names the files and nothing checks the name against the
    // folder, so a layer that is renamed or moved — as the accessories were,
    // from one shared sheet to one per silhouette — fails silently: Phaser
    // skips the texture and the part just never appears on the avatar.
    const layers = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../client/public/assets/avatars/layers',
    )
    const missing = allLayerSheets()
      .map(layerSheetFile)
      .filter((file) => !existsSync(resolve(layers, file)))
    expect(missing).toEqual([])
  })
})

describe('sanitizeAgentCount', () => {
  it('passes every valid count through untouched', () => {
    for (let n = 0; n <= MAX_AGENTS; n++) expect(sanitizeAgentCount(n)).toBe(n)
  })

  it('clamps a count outside the range to the nearest end', () => {
    expect(sanitizeAgentCount(-1)).toBe(0)
    expect(sanitizeAgentCount(-99)).toBe(0)
    expect(sanitizeAgentCount(MAX_AGENTS + 1)).toBe(MAX_AGENTS)
    expect(sanitizeAgentCount(99)).toBe(MAX_AGENTS)
  })

  it('truncates a fractional count', () => {
    expect(sanitizeAgentCount(2.5)).toBe(2)
    expect(sanitizeAgentCount(0.9)).toBe(0)
    expect(sanitizeAgentCount(-0.5)).toBe(0)
  })

  it('reads anything that is not a finite number as no agents', () => {
    expect(sanitizeAgentCount(undefined)).toBe(DEFAULT_AGENTS)
    expect(sanitizeAgentCount(null)).toBe(DEFAULT_AGENTS)
    expect(sanitizeAgentCount('3')).toBe(DEFAULT_AGENTS)
    expect(sanitizeAgentCount(NaN)).toBe(DEFAULT_AGENTS)
    expect(sanitizeAgentCount(Infinity)).toBe(DEFAULT_AGENTS)
    expect(sanitizeAgentCount({ agents: 3 })).toBe(DEFAULT_AGENTS)
  })
})

describe('agent types', () => {
  it('offers exactly four types with unique ids, the robot first', () => {
    expect(AGENT_TYPES).toHaveLength(4)
    expect(new Set(AGENT_TYPE_IDS).size).toBe(4)
    // The default is the look every identity from before the picker keeps.
    expect(DEFAULT_AGENT_TYPE).toBe('robot')
    expect(AGENT_TYPE_IDS).toContain(DEFAULT_AGENT_TYPE)
  })

  it('every type has a label to show in the picker', () => {
    for (const type of AGENT_TYPES) expect(type.label.trim().length).toBeGreaterThan(0)
  })

  it('sanitizeAgentType accepts only ids from the catalogue', () => {
    for (const id of AGENT_TYPE_IDS) expect(sanitizeAgentType(id)).toBe(id)
  })

  it('reads an unknown, empty or malformed type as the default robot', () => {
    expect(sanitizeAgentType('dragon')).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType('')).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType('   ')).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType('Duck')).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType(undefined)).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType(null)).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType(3)).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType(['duck'])).toBe(DEFAULT_AGENT_TYPE)
    expect(sanitizeAgentType({ agentType: 'duck' })).toBe(DEFAULT_AGENT_TYPE)
  })
})
