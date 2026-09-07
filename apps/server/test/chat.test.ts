import { describe, expect, it } from 'vitest'
import { CHAT_MAX_LENGTH, DEFAULT_AVATAR, OfficeState, Player, sanitizeChatText } from '@vto/shared'
import { BubbleManager } from '../src/bubbles'
import { ChatRelay } from '../src/chat'

const RADIUS = 64

/**
 * Arma un estado con los jugadores dados en sus posiciones y deja que el
 * `BubbleManager` real decida las burbujas: así el chat se prueba contra la
 * misma membresía que produce el juego, no contra una inventada.
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

describe('ChatRelay: el mensaje solo llega a la burbuja del remitente', () => {
  it('lo reciben los otros miembros y nadie de afuera', () => {
    // a, b y c pegados (una burbuja de 3); d lejos, sin burbuja.
    const { chat, state } = scenario({
      a: { x: 100, y: 100 },
      b: { x: 120, y: 100 },
      c: { x: 110, y: 130 },
      d: { x: 600, y: 600 },
    })
    expect(state.players.get('a')!.bubbleId).not.toBe('')
    expect(state.players.get('d')!.bubbleId).toBe('')

    const outcome = chat.submit('a', { id: 'm1', text: 'hola' }, 1_000)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect([...outcome.recipients].sort()).toEqual(['a', 'b', 'c'])
    expect(outcome.recipients).not.toContain('d')
    expect(outcome.message).toMatchObject({
      id: 'm1',
      from: 'a',
      name: 'A',
      text: 'hola',
      at: 1_000,
    })
  })

  it('el que se aleja deja de estar entre los destinatarios', () => {
    const { chat, moveTo } = scenario({
      a: { x: 100, y: 100 },
      b: { x: 120, y: 100 },
      c: { x: 110, y: 130 },
    })
    moveTo('c', 800, 800)
    const outcome = chat.submit('a', { id: 'm2', text: 'seguimos?' }, 1_000)
    expect(outcome.ok && [...outcome.recipients].sort()).toEqual(['a', 'b'])
    // Y el que se fue tampoco puede escribirle a la burbuja que dejó.
    const alone = chat.submit('c', { id: 'm3', text: 'me escuchan?' }, 1_100)
    expect(alone).toEqual({ ok: false, error: { id: 'm3', reason: 'no_bubble' } })
  })

  it('sin burbuja el mensaje se rechaza con "no_bubble"', () => {
    const { chat } = scenario({ a: { x: 100, y: 100 }, b: { x: 600, y: 600 } })
    expect(chat.submit('a', { id: 'm4', text: 'hola?' }, 1_000)).toEqual({
      ok: false,
      error: { id: 'm4', reason: 'no_bubble' },
    })
  })

  it('nada del mensaje queda en el estado (son efímeros)', () => {
    const { chat, state } = scenario({ a: { x: 100, y: 100 }, b: { x: 120, y: 100 } })
    chat.submit('a', { id: 'm5', text: 'esto no se guarda' }, 1_000)
    expect(JSON.stringify(state.toJSON())).not.toContain('esto no se guarda')
  })
})

describe('ChatRelay: validación y tope de ritmo', () => {
  const together = { a: { x: 100, y: 100 }, b: { x: 120, y: 100 } }

  it('rechaza el mensaje más largo que el límite y el vacío', () => {
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

  it('el texto con HTML viaja tal cual, sin escapar ni recortar', () => {
    const { chat } = scenario(together)
    const html = '<script>alert(1)</script> <b>hola</b>'
    const outcome = chat.submit('a', { id: 'm8', text: html }, 1_000)
    expect(outcome.ok && outcome.message.text).toBe(html)
  })

  it('normaliza saltos de línea, invisibles y espacios repetidos', () => {
    expect(sanitizeChatText('hola\n\n   mundo​‮')).toBe('hola mundo')
    expect(sanitizeChatText(42)).toBe('')
  })

  it('corta al pasar el tope de mensajes por ventana y vuelve a dejar pasar después', () => {
    const { chat } = scenario(together)
    for (let i = 0; i < 5; i++) {
      expect(chat.submit('a', { id: `r${i}`, text: `msg ${i}` }, 1_000).ok).toBe(true)
    }
    expect(chat.submit('a', { id: 'r5', text: 'uno más' }, 1_000)).toEqual({
      ok: false,
      error: { id: 'r5', reason: 'rate_limited' },
    })
    // El tope es por jugador: el otro sigue pudiendo escribir.
    expect(chat.submit('b', { id: 'r6', text: 'yo puedo' }, 1_000).ok).toBe(true)
    // Pasada la ventana, el primero también.
    expect(chat.submit('a', { id: 'r7', text: 'ya pasó' }, 3_100).ok).toBe(true)
  })

  it('pone un id propio si el que manda el cliente no sirve', () => {
    const { chat } = scenario(together)
    const outcome = chat.submit('a', { id: '<img src=x>', text: 'hola' }, 1_000)
    expect(outcome.ok && outcome.message.id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
