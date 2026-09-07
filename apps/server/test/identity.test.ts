import { describe, expect, it } from 'vitest'
import {
  AVATAR_IDS,
  AVATARS,
  DEFAULT_AVATAR,
  isDirection,
  NAME_MAX_LENGTH,
  sanitizeAvatar,
  sanitizeName,
} from '@vto/shared'

describe('catálogo de avatares', () => {
  it('ofrece exactamente 8 avatares con ids únicos', () => {
    expect(AVATARS).toHaveLength(8)
    expect(new Set(AVATAR_IDS).size).toBe(8)
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
