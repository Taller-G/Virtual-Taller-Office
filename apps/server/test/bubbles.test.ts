import { describe, expect, it } from 'vitest'
import { OfficeState, Player } from '@vto/shared'
import { BubbleManager, type BubbleEvents } from '../src/bubbles'

const RADIUS = 64

function setup(maxMembers = 6, events: BubbleEvents = {}) {
  const state = new OfficeState()
  const bubbles = new BubbleManager(state, { radius: RADIUS, maxMembers }, events)
  const add = (id: string, x: number, y: number) => {
    const player = new Player({ sessionId: id, name: id, avatar: 'adam', x, y })
    state.players.set(id, player)
    bubbles.onPlayerMoved(player)
    return player
  }
  const move = (player: Player, x: number, y: number) => {
    player.x = x
    player.y = y
    bubbles.onPlayerMoved(player)
  }
  return { state, bubbles, add, move }
}

describe('BubbleManager: burbujas por proximidad (semántica WorkAdventure)', () => {
  it('replica radio y tope en el estado para que el cliente use los mismos valores', () => {
    const { state } = setup(4)
    expect(state.bubbleRadius).toBe(RADIUS)
    expect(state.bubbleMaxMembers).toBe(4)
  })

  it('dos jugadores sin burbuja a menos del radio forman una burbuja en su punto medio', () => {
    const { state, add, move } = setup()
    const a = add('a', 100, 100)
    const b = add('b', 400, 100)
    expect(state.bubbles.size).toBe(0)

    move(b, 100 + RADIUS + 1, 100)
    expect(state.bubbles.size).toBe(0)

    move(b, 100 + RADIUS, 100)
    expect(state.bubbles.size).toBe(1)
    const bubble = [...state.bubbles.values()][0]
    expect(a.bubbleId).toBe(bubble.id)
    expect(b.bubbleId).toBe(bubble.id)
    expect([...bubble.members]).toEqual(['b', 'a'])
    expect(bubble.x).toBe(100 + RADIUS / 2)
    expect(bubble.y).toBe(100)
  })

  it('un tercero que se acerca al centro se suma y el baricentro se recalcula', () => {
    const { state, add, move } = setup()
    add('a', 100, 100)
    add('b', 140, 100)
    const c = add('c', 500, 500)
    const bubble = [...state.bubbles.values()][0]
    expect(bubble.members.length).toBe(2)

    move(c, 120, 100 + RADIUS)
    expect(state.bubbles.size).toBe(1)
    expect(bubble.members.length).toBe(3)
    expect(c.bubbleId).toBe(bubble.id)
    expect(bubble.x).toBe(120)
    expect(bubble.y).toBe(100 + RADIUS / 3)
  })

  it('al alejarse más del radio del baricentro el jugador sale; los demás siguen', () => {
    const { state, add, move } = setup()
    const a = add('a', 100, 100)
    const b = add('b', 140, 100)
    const c = add('c', 120, 140)
    const bubble = [...state.bubbles.values()][0]
    expect(bubble.members.length).toBe(3)

    move(c, 120, 400)
    expect(c.bubbleId).toBe('')
    expect(state.bubbles.size).toBe(1)
    expect([...bubble.members].sort()).toEqual(['a', 'b'])
    expect(a.bubbleId).toBe(bubble.id)
    expect(b.bubbleId).toBe(bubble.id)
    expect(bubble.x).toBe(120)
    expect(bubble.y).toBe(100)
  })

  it('cuando queda un solo miembro la burbuja se destruye', () => {
    const { state, add, move } = setup()
    const a = add('a', 100, 100)
    const b = add('b', 140, 100)
    expect(state.bubbles.size).toBe(1)

    move(b, 900, 900)
    expect(state.bubbles.size).toBe(0)
    expect(a.bubbleId).toBe('')
    expect(b.bubbleId).toBe('')
  })

  it('medir contra el baricentro da histéresis: se juntan a R y se sueltan recién a 2R', () => {
    const { state, add, move } = setup()
    add('a', 100, 100)
    const b = add('b', 100 + RADIUS, 100)
    expect(state.bubbles.size).toBe(1)

    move(b, 100 + 2 * RADIUS, 100) // el baricentro queda a R exacto: sigue adentro
    expect(state.bubbles.size).toBe(1)
    move(b, 100 + 2 * RADIUS + 1, 100)
    expect(state.bubbles.size).toBe(0)
  })

  it('una burbuja llena no absorbe a nadie más', () => {
    const { state, add, move } = setup(3)
    add('a', 100, 100)
    add('b', 110, 100)
    add('c', 100, 110)
    const d = add('d', 500, 500)
    const bubble = [...state.bubbles.values()][0]
    expect(bubble.members.length).toBe(3)

    move(d, 104, 104)
    expect(d.bubbleId).toBe('')
    expect(bubble.members.length).toBe(3)
    expect(state.bubbles.size).toBe(1)

    // Dos libres al lado de una burbuja llena forman la suya propia.
    const e = add('e', 500, 500)
    move(e, 108, 108)
    expect(state.bubbles.size).toBe(2)
    expect(d.bubbleId).not.toBe('')
    expect(d.bubbleId).toBe(e.bubbleId)
    expect(d.bubbleId).not.toBe(bubble.id)
  })

  it('un jugador que sale de la sala deja su burbuja (y la destruye si queda uno)', () => {
    const { state, bubbles, add } = setup()
    const a = add('a', 100, 100)
    const b = add('b', 140, 100)
    const c = add('c', 120, 140)
    const bubble = [...state.bubbles.values()][0]

    state.players.delete('c')
    bubbles.onPlayerLeft(c)
    expect([...bubble.members].sort()).toEqual(['a', 'b'])
    expect(bubble.x).toBe(120)

    state.players.delete('b')
    bubbles.onPlayerLeft(b)
    expect(state.bubbles.size).toBe(0)
    expect(a.bubbleId).toBe('')
  })

  it('al destruirse una burbuja, el que queda libre se agrupa con quien tenga al lado', () => {
    // Tope 2: a y b conversan, c está al lado esperando lugar.
    const { state, bubbles, add } = setup(2)
    const a = add('a', 100, 100)
    const b = add('b', 120, 100)
    const c = add('c', 130, 100)
    expect(state.bubbles.size).toBe(1)
    expect(c.bubbleId).toBe('')

    // a se va de la sala: la burbuja queda con uno y se destruye, pero b y c
    // siguen pegados, así que la burbuja nueva sale sin que nadie camine.
    state.players.delete('a')
    bubbles.onPlayerLeft(a)
    expect(state.bubbles.size).toBe(1)
    const [bubble] = [...state.bubbles.values()]
    expect([...bubble.members].sort()).toEqual(['b', 'c'])
    expect(b.bubbleId).toBe(bubble.id)
    expect(c.bubbleId).toBe(bubble.id)
    expect(a.bubbleId).toBe('')
  })

  it('una burbuja que deja de estar llena absorbe a quien esperaba al lado', () => {
    const { state, add, move } = setup(3)
    add('a', 100, 100)
    add('b', 110, 100)
    const c = add('c', 120, 100)
    const d = add('d', 130, 100)
    const [bubble] = [...state.bubbles.values()]
    expect(bubble.members.length).toBe(3)
    expect(d.bubbleId).toBe('')

    // c se aleja: la burbuja baja a dos y d, que estaba al alcance, entra.
    move(c, 600, 600)
    expect(c.bubbleId).toBe('')
    expect(state.bubbles.size).toBe(1)
    expect([...bubble.members].sort()).toEqual(['a', 'b', 'd'])
    expect(d.bubbleId).toBe(bubble.id)
  })

  it('elige la opción más cercana entre un jugador libre y una burbuja', () => {
    const { state, add, move } = setup()
    add('a', 100, 100)
    add('b', 140, 100) // burbuja centrada en (120, 100)
    add('c', 300, 100)
    const d = add('d', 500, 500)

    // A 40 px de c y a 140 px del centro de la burbuja: forma una nueva con c.
    move(d, 260, 100)
    expect(state.bubbles.size).toBe(2)
    expect(d.bubbleId).toBe(state.players.get('c')!.bubbleId)
  })

  it('emite los eventos de creación, entrada, salida y destrucción', () => {
    const log: string[] = []
    const { add, move } = setup(6, {
      onCreated: (b) => log.push(`created ${b.id}`),
      onJoined: (b, p) => log.push(`joined ${p.sessionId}`),
      onLeft: (b, p) => log.push(`left ${p.sessionId}`),
      onDestroyed: (b) => log.push(`destroyed ${b.id}`),
    })
    add('a', 100, 100)
    const b = add('b', 140, 100)
    move(b, 900, 900)
    expect(log).toEqual(['created b1', 'joined b', 'joined a', 'left b', 'left a', 'destroyed b1'])
  })
})
