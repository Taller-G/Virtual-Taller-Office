import { describe, expect, it } from 'vitest'
import { CHAT_MAX_LENGTH, DEFAULT_AVATAR, OfficeState, Player, sanitizeChatText } from '@vto/shared'
import { BubbleManager } from '../src/bubbles'
import { ChatRelay } from '../src/chat'

const RADIUS = 64

/**
 * Builds a state with the given players at their positions and lets the real
 * `BubbleManager` decide the bubbles: that way the chat is tested against the
 * same membership the game produces, not against a made-up one.
 */
function scenario(positions: Record<string, { x: number; y: number }>) {
  const state = new OfficeState()
  const bubbles = new BubbleManager(state, { radius: RADIUS, maxMembers: 6 })
  for (const [sessionId, { x, y }] of Object.entries(positions)) {
    const player = new Player({
      sessionId,
      name: sessionId.toUpperCase(),
      avatar: DEFAULT_AVATAR,
      x,
      y,
    })
    state.players.set(sessionId, player)
    bubbles.onPlayerMoved(player)
  }
  const chat = new ChatRelay(state, { maxPerWindow: 5, windowMs: 2_000 })
  const moveTo = (sessionId: string, x: number, y: number) => {
    const player = state.players.get(sessionId)!
    player.x = x
    player.y = y
    bubbles.onPlayerMoved(player)
  }
  return { state, bubbles, chat, moveTo }
}

describe('ChatRelay: the message only reaches the sender\'s bubble', () => {
  it('the other members receive it and nobody outside does', () => {
    // a, b and c next to each other (a bubble of 3); d far away, no bubble.
    const { chat, state } = scenario({
      a: { x: 100, y: 100 },
      b: { x: 120, y: 100 },
      c: { x: 110, y: 130 },
      d: { x: 600, y: 600 },
    })
    expect(state.players.get('a')!.bubbleId).not.toBe('')
    expect(state.players.get('d')!.bubbleId).toBe('')

    const outcome = chat.submit('a', { id: 'm1', text: 'hi' }, 1_000)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect([...outcome.recipients].sort()).toEqual(['a', 'b', 'c'])
    expect(outcome.recipients).not.toContain('d')
    expect(outcome.message).toMatchObject({
      id: 'm1',
      from: 'a',
      name: 'A',
      text: 'hi',
      at: 1_000,
    })
  })

  it('whoever walks away stops being among the recipients', () => {
    const { chat, moveTo } = scenario({
      a: { x: 100, y: 100 },
      b: { x: 120, y: 100 },
      c: { x: 110, y: 130 },
    })
    moveTo('c', 800, 800)
    const outcome = chat.submit('a', { id: 'm2', text: 'still there?' }, 1_000)
    expect(outcome.ok && [...outcome.recipients].sort()).toEqual(['a', 'b'])
    // And whoever left cannot write to the bubble they left either.
    const alone = chat.submit('c', { id: 'm3', text: 'can you hear me?' }, 1_100)
    expect(alone).toEqual({ ok: false, error: { id: 'm3', reason: 'no_bubble' } })
  })

  it('without a bubble the message is rejected with "no_bubble"', () => {
    const { chat } = scenario({ a: { x: 100, y: 100 }, b: { x: 600, y: 600 } })
    expect(chat.submit('a', { id: 'm4', text: 'hello?' }, 1_000)).toEqual({
      ok: false,
      error: { id: 'm4', reason: 'no_bubble' },
    })
  })

  it('nothing from the message is left in the state (they are ephemeral)', () => {
    const { chat, state } = scenario({ a: { x: 100, y: 100 }, b: { x: 120, y: 100 } })
    chat.submit('a', { id: 'm5', text: 'this is not stored' }, 1_000)
    expect(JSON.stringify(state.toJSON())).not.toContain('this is not stored')
  })
})

describe('ChatRelay: validation and rate limit', () => {
  const together = { a: { x: 100, y: 100 }, b: { x: 120, y: 100 } }

  it('rejects a message longer than the limit and an empty one', () => {
    const { chat } = scenario(together)
    const long = 'x'.repeat(CHAT_MAX_LENGTH + 1)
    expect(chat.submit('a', { id: 'm6', text: long }, 1_000)).toEqual({
      ok: false,
      error: { id: 'm6', reason: 'too_long' },
    })
    expect(chat.submit('a', { id: 'm7', text: '   ' }, 1_000)).toEqual({
      ok: false,
      error: { id: 'm7', reason: 'empty' },
    })
  })

  it('text with HTML travels as is, neither escaped nor truncated', () => {
    const { chat } = scenario(together)
    const html = '<script>alert(1)</script> <b>hi</b>'
    const outcome = chat.submit('a', { id: 'm8', text: html }, 1_000)
    expect(outcome.ok && outcome.message.text).toBe(html)
  })

  it('normalises line breaks, invisible characters and repeated spaces', () => {
    expect(sanitizeChatText('hello\n\n   world​‮')).toBe('hello world')
    expect(sanitizeChatText(42)).toBe('')
  })

  it('cuts off past the per-window message cap and lets messages through again afterwards', () => {
    const { chat } = scenario(together)
    for (let i = 0; i < 5; i++) {
      expect(chat.submit('a', { id: `r${i}`, text: `msg ${i}` }, 1_000).ok).toBe(true)
    }
    expect(chat.submit('a', { id: 'r5', text: 'one more' }, 1_000)).toEqual({
      ok: false,
      error: { id: 'r5', reason: 'rate_limited' },
    })
    // The cap is per player: the other one can still write.
    expect(chat.submit('b', { id: 'r6', text: 'I can' }, 1_000).ok).toBe(true)
    // Once the window has passed, so can the first one.
    expect(chat.submit('a', { id: 'r7', text: 'it passed' }, 3_100).ok).toBe(true)
  })

  it('assigns its own id when the one the client sends is unusable', () => {
    const { chat } = scenario(together)
    const outcome = chat.submit('a', { id: '<img src=x>', text: 'hi' }, 1_000)
    expect(outcome.ok && outcome.message.id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
