import { describe, expect, it } from 'vitest'
import { DEFAULT_AVATAR, OfficeState, Player } from '@vto/shared'
import { WaveRelay } from '../src/waves'

const COOLDOWN = 3_000

/** A room with the named people in it, far apart: a wave must not care. */
function scenario(...names: string[]) {
  const state = new OfficeState()
  names.forEach((sessionId, index) => {
    state.players.set(
      sessionId,
      new Player({
        sessionId,
        name: sessionId.toUpperCase(),
        avatar: DEFAULT_AVATAR,
        // Hundreds of pixels apart, well past any bubble radius.
        x: index * 500,
        y: 0,
      }),
    )
  })
  return { state, waves: new WaveRelay(state, { cooldownMs: COOLDOWN }) }
}

describe('WaveRelay', () => {
  it('delivers a wave to the person it names, and to nobody else', () => {
    const { waves } = scenario('a', 'b', 'c')
    const outcome = waves.submit('a', { to: 'b' }, 0)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.to).toBe('b')
    expect(outcome.wave).toEqual({ from: 'a', name: 'A' })
  })

  it('crosses the room: proximity is not a condition', () => {
    const { state, waves } = scenario('a', 'b')
    // Deliberately further apart than any bubble would ever be.
    state.players.get('b')!.x = 10_000
    expect(waves.submit('a', { to: 'b' }, 0).ok).toBe(true)
  })

  it('carries the name the waver had at that moment', () => {
    const { state, waves } = scenario('a', 'b')
    state.players.get('a')!.name = 'Renamed'
    const outcome = waves.submit('a', { to: 'b' }, 0)
    expect(outcome.ok && outcome.wave.name).toBe('Renamed')
  })

  it('refuses a target who is not in the room', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', { to: 'nobody' }, 0)).toEqual({
      ok: false,
      reason: 'unknown_target',
    })
  })

  it('refuses a wave with no target at all', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', undefined, 0)).toEqual({ ok: false, reason: 'unknown_target' })
    expect(waves.submit('a', { to: '' }, 0)).toEqual({ ok: false, reason: 'unknown_target' })
  })

  it('refuses a sender who is not in the room', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('ghost', { to: 'a' }, 0)).toEqual({
      ok: false,
      reason: 'unknown_target',
    })
  })

  it('refuses waving at oneself', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', { to: 'a' }, 0)).toEqual({ ok: false, reason: 'self' })
  })

  it('holds the sender to one wave per cooldown', () => {
    const { waves } = scenario('a', 'b', 'c')
    expect(waves.submit('a', { to: 'b' }, 0).ok).toBe(true)
    expect(waves.submit('a', { to: 'b' }, COOLDOWN - 1)).toEqual({
      ok: false,
      reason: 'cooldown',
    })
    // The cooldown is on the person waving, not on the pair.
    expect(waves.submit('a', { to: 'c' }, COOLDOWN - 1)).toEqual({
      ok: false,
      reason: 'cooldown',
    })
    expect(waves.submit('a', { to: 'b' }, COOLDOWN).ok).toBe(true)
  })

  it("does not let one person's cooldown silence another's", () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', { to: 'b' }, 0).ok).toBe(true)
    expect(waves.submit('b', { to: 'a' }, 0).ok).toBe(true)
  })

  it('a rejected wave does not restart the cooldown', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', { to: 'b' }, 0).ok).toBe(true)
    // Rejected at 1000: it must not push the next allowed wave out to 4000.
    expect(waves.submit('a', { to: 'b' }, 1_000).ok).toBe(false)
    expect(waves.submit('a', { to: 'b' }, COOLDOWN).ok).toBe(true)
  })

  it('forgets whoever leaves', () => {
    const { waves } = scenario('a', 'b')
    expect(waves.submit('a', { to: 'b' }, 0).ok).toBe(true)
    waves.forget('a')
    // Rejoining as the same session starts with a clean cooldown.
    expect(waves.submit('a', { to: 'b' }, 1).ok).toBe(true)
  })
})
