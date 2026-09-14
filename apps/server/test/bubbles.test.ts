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

describe('BubbleManager: proximity bubbles (WorkAdventure semantics)', () => {
  it('replicates radius and cap in the state so the client uses the same values', () => {
    const { state } = setup(4)
    expect(state.bubbleRadius).toBe(RADIUS)
    expect(state.bubbleMaxMembers).toBe(4)
  })

  it('two players without a bubble within the radius form a bubble at their midpoint', () => {
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

  it('a third one approaching the centre joins and the centroid is recomputed', () => {
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

  it('moving further than the radius from the centroid the player leaves; the rest stay', () => {
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

  it('when a single member is left the bubble is destroyed', () => {
    const { state, add, move } = setup()
    const a = add('a', 100, 100)
    const b = add('b', 140, 100)
    expect(state.bubbles.size).toBe(1)

    move(b, 900, 900)
    expect(state.bubbles.size).toBe(0)
    expect(a.bubbleId).toBe('')
    expect(b.bubbleId).toBe('')
  })

  it('measuring against the centroid gives hysteresis: they join at R and only break apart at 2R', () => {
    const { state, add, move } = setup()
    add('a', 100, 100)
    const b = add('b', 100 + RADIUS, 100)
    expect(state.bubbles.size).toBe(1)

    move(b, 100 + 2 * RADIUS, 100) // the centroid ends up at exactly R: still inside
    expect(state.bubbles.size).toBe(1)
    move(b, 100 + 2 * RADIUS + 1, 100)
    expect(state.bubbles.size).toBe(0)
  })

  it('a full bubble absorbs nobody else', () => {
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

    // Two free players next to a full bubble form one of their own.
    const e = add('e', 500, 500)
    move(e, 108, 108)
    expect(state.bubbles.size).toBe(2)
    expect(d.bubbleId).not.toBe('')
    expect(d.bubbleId).toBe(e.bubbleId)
    expect(d.bubbleId).not.toBe(bubble.id)
  })

  it('a player leaving the room leaves their bubble (and destroys it if one is left)', () => {
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

  it('when a bubble is destroyed, whoever is freed groups up with the person next to them', () => {
    // Cap 2: a and b are talking, c is next to them waiting for a slot.
    const { state, bubbles, add } = setup(2)
    const a = add('a', 100, 100)
    const b = add('b', 120, 100)
    const c = add('c', 130, 100)
    expect(state.bubbles.size).toBe(1)
    expect(c.bubbleId).toBe('')

    // a leaves the room: the bubble is left with one and is destroyed, but b
    // and c are still next to each other, so the new bubble forms without
    // anyone walking.
    state.players.delete('a')
    bubbles.onPlayerLeft(a)
    expect(state.bubbles.size).toBe(1)
    const [bubble] = [...state.bubbles.values()]
    expect([...bubble.members].sort()).toEqual(['b', 'c'])
    expect(b.bubbleId).toBe(bubble.id)
    expect(c.bubbleId).toBe(bubble.id)
    expect(a.bubbleId).toBe('')
  })

  it('a bubble that stops being full absorbs whoever was waiting next to it', () => {
    const { state, add, move } = setup(3)
    add('a', 100, 100)
    add('b', 110, 100)
    const c = add('c', 120, 100)
    const d = add('d', 130, 100)
    const [bubble] = [...state.bubbles.values()]
    expect(bubble.members.length).toBe(3)
    expect(d.bubbleId).toBe('')

    // c walks away: the bubble drops to two and d, who was within reach, joins.
    move(c, 600, 600)
    expect(c.bubbleId).toBe('')
    expect(state.bubbles.size).toBe(1)
    expect([...bubble.members].sort()).toEqual(['a', 'b', 'd'])
    expect(d.bubbleId).toBe(bubble.id)
  })

  it('picks the closest option between a free player and a bubble', () => {
    const { state, add, move } = setup()
    add('a', 100, 100)
    add('b', 140, 100) // bubble centred at (120, 100)
    add('c', 300, 100)
    const d = add('d', 500, 500)

    // 40 px from c and 140 px from the bubble's centre: it forms a new one with c.
    move(d, 260, 100)
    expect(state.bubbles.size).toBe(2)
    expect(d.bubbleId).toBe(state.players.get('c')!.bubbleId)
  })

  it('emits the created, joined, left and destroyed events', () => {
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
