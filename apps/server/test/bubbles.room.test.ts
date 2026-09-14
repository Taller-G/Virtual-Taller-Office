import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as SdkRoom } from '@colyseus/sdk'
import { DEFAULT_WORLD_ID, Message, roomNameFor, type OfficeState } from '@vto/shared'
import app from '../src/app.config'
import { config } from '../src/config'
import type { WorldRoom } from '../src/rooms/WorldRoom'

type TestClient = SdkRoom<WorldRoom, OfficeState>

/** Waits until `predicate` is true or `timeoutMs` expires; returns how many ms it took. */
async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return Date.now() - started
}

/**
 * Everything that defines "who is in which bubble", in comparable form: the
 * bubbles with their members and each player's `bubbleId`. It works the same
 * for the server's state and for any client's, so they can be required to
 * match exactly.
 */
function snapshot(state: OfficeState) {
  return JSON.stringify({
    bubbles: [...state.bubbles.entries()]
      .map(([id, bubble]) => [id, [...bubble.members].sort()] as const)
      .sort(),
    players: [...state.players.entries()]
      .map(([id, player]) => [id, player.bubbleId] as const)
      .sort(),
  })
}

describe('A world\'s room: proximity conversation bubbles', () => {
  let colyseus: ColyseusTestServer
  let room: WorldRoom
  const clients: TestClient[] = []
  /** BUBBLE_RADIUS_PX in vitest.config.ts (2 tiles of 32 px). */
  const RADIUS = 64
  /** Far from the map's spawn (848, 208) and from the test positions. */
  const FAR = { x: 300, y: 700 }

  async function connect(name: string, x: number, y: number) {
    const client = await colyseus.connectTo(room, { name })
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    await client.waitForInitialState()
    // Each player starts at a controlled place, not at the map's spawn.
    await moveTo(client, x, y)
    return client
  }

  /** Sends the position and waits until the server has applied it (x **and** y). */
  function moveTo(client: TestClient, x: number, y: number) {
    client.send(Message.MOVE, { x, y, dir: 'down', moving: false })
    return waitFor(
      () => {
        const player = room.state.players.get(client.sessionId)
        return player?.x === x && player?.y === y
      },
      1_000,
      `the server moves "${client.sessionId}" to (${x}, ${y})`,
    )
  }

  /** Waits until every client sees exactly the server's bubbles. */
  async function waitConverged(timeoutMs = 1_000) {
    const expected = snapshot(room.state)
    for (const client of clients) {
      await waitFor(
        () => snapshot(client.state) === expected,
        timeoutMs,
        `"${client.sessionId}" converges with the server`,
      )
    }
    return expected
  }

  async function leaveQuietly(client: TestClient) {
    await Promise.race([
      client.leave(true).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
  }

  beforeAll(async () => {
    colyseus = await boot(app)
  })

  afterAll(async () => {
    await colyseus.shutdown()
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) await leaveQuietly(client)
    await colyseus.cleanup()
  })

  async function createRoom() {
    room = await colyseus.createRoom<WorldRoom>(roomNameFor(DEFAULT_WORLD_ID), {})
  }

  it('radius and cap come from the configuration and are replicated to the clients', async () => {
    await createRoom()
    expect(room.bubbles.radius).toBe(RADIUS)
    expect(room.bubbles.maxMembers).toBe(config.bubbleMaxMembers)
    const a = await connect('a', 100, 100)
    expect(a.state.bubbleRadius).toBe(RADIUS)
    expect(a.state.bubbleMaxMembers).toBe(config.bubbleMaxMembers)
  })

  it('1. two players approaching each other see the same bubble on both clients in under 300 ms', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', FAR.x, FAR.y)
    expect(room.state.bubbles.size).toBe(0)

    const started = Date.now()
    b.send(Message.MOVE, { x: 100 + RADIUS, y: 100, dir: 'left', moving: true })
    // Both seeing a bubble is a change from 0 to 1: it cannot give a false positive.
    await waitFor(
      () => a.state.bubbles.size === 1 && b.state.bubbles.size === 1,
      300,
      'both see it',
    )
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(300)

    expect(room.state.bubbles.size).toBe(1)
    const [bubble] = [...room.state.bubbles.values()]
    await waitConverged()
    for (const client of [a, b]) {
      const seen = client.state.bubbles.get(bubble.id)!
      expect([...seen.members].sort()).toEqual([a.sessionId, b.sessionId].sort())
      expect(client.state.players.get(a.sessionId)?.bubbleId).toBe(bubble.id)
      expect(client.state.players.get(b.sessionId)?.bubbleId).toBe(bubble.id)
      // The centre is the centroid of the two.
      expect(seen.x).toBe(100 + RADIUS / 2)
      expect(seen.y).toBe(100)
    }
  })

  it('2. a third one approaching joins the same bubble and all three see three members', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'bubble of a and b')
    const [bubble] = [...room.state.bubbles.values()]
    const c = await connect('c', FAR.x, FAR.y)
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe('')

    await moveTo(c, 120, 100 + RADIUS)
    await waitFor(() => bubble.members.length === 3, 1_000, 'the server adds c')
    await waitConverged()

    for (const client of [a, b, c]) {
      const seen = client.state.bubbles.get(bubble.id)!
      expect(seen.members.length).toBe(3)
      expect([...seen.members].sort()).toEqual([a.sessionId, b.sessionId, c.sessionId].sort())
      expect(client.state.players.get(c.sessionId)?.bubbleId).toBe(bubble.id)
    }
    expect(room.state.bubbles.size).toBe(1)
  })

  it('3. when one walks away they leave the bubble; the other two stay inside', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    const c = await connect('c', 120, 140)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'one bubble')
    const [bubble] = [...room.state.bubbles.values()]
    await waitFor(() => bubble.members.length === 3, 1_000, 'bubble of three')

    await moveTo(c, 120, 500)
    await waitFor(
      () => room.state.players.get(c.sessionId)?.bubbleId === '',
      1_000,
      'the server removes c',
    )
    await waitConverged()

    for (const client of [a, b, c]) {
      const seen = client.state.bubbles.get(bubble.id)!
      expect([...seen.members].sort()).toEqual([a.sessionId, b.sessionId].sort())
      expect(client.state.players.get(a.sessionId)?.bubbleId).toBe(bubble.id)
      expect(client.state.players.get(b.sessionId)?.bubbleId).toBe(bubble.id)
      expect(client.state.players.get(c.sessionId)?.bubbleId).toBe('')
      // The centre goes back to that of the two that are left.
      expect(seen.x).toBe(120)
      expect(seen.y).toBe(100)
    }
  })

  it('4. when a single one is left, the bubble disappears for them', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'bubble of two')

    await moveTo(b, FAR.x, FAR.y)
    await waitFor(() => room.state.bubbles.size === 0, 1_000, 'the server destroys it')
    await waitConverged()
    for (const client of [a, b]) {
      expect(client.state.bubbles.size).toBe(0)
      expect(client.state.players.get(a.sessionId)?.bubbleId).toBe('')
      expect(client.state.players.get(b.sessionId)?.bubbleId).toBe('')
    }

    // The same if the other one leaves the room instead of walking away.
    const c = await connect('c', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'bubble with c')
    await c.leave(true)
    clients.splice(clients.indexOf(c), 1)
    await waitFor(() => room.state.bubbles.size === 0, 1_000, 'it is destroyed when c leaves')
    await waitConverged()
    expect(a.state.bubbles.size).toBe(0)
    expect(a.state.players.get(a.sessionId)?.bubbleId).toBe('')
  })

  it('5. with the cap at N, the N+1th player who approaches does not join and sees the bubble full', async () => {
    await createRoom()
    const n = config.bubbleMaxMembers
    const members: TestClient[] = []
    for (let i = 0; i < n; i++) {
      // On a small circle around (100, 100): all within the radius.
      const angle = (i / n) * Math.PI * 2
      members.push(
        await connect(
          `m${i}`,
          Math.round(100 + Math.cos(angle) * 10),
          Math.round(100 + Math.sin(angle) * 10),
        ),
      )
    }
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'one bubble')
    const [bubble] = [...room.state.bubbles.values()]
    await waitFor(() => bubble.members.length === n, 1_000, `full bubble (${n})`)

    const extra = await connect('extra', FAR.x, FAR.y)
    await moveTo(extra, 104, 104)
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(extra.sessionId)?.bubbleId).toBe('')
    expect(bubble.members.length).toBe(n)
    expect(room.state.bubbles.size).toBe(1)
    await waitConverged()

    // What the client uses to show "bubble full": I have no bubble, and the
    // one within my reach is at the cap, with the server's own radius and cap.
    const me = extra.state.players.get(extra.sessionId)!
    const seen = extra.state.bubbles.get(bubble.id)!
    expect(me.bubbleId).toBe('')
    expect(Math.hypot(me.x - seen.x, me.y - seen.y)).toBeLessThanOrEqual(extra.state.bubbleRadius)
    expect(seen.members.length).toBe(extra.state.bubbleMaxMembers)

    // Two left over form their own bubble instead of joining the full one.
    const other = await connect('other', FAR.x, FAR.y)
    await moveTo(other, 108, 108)
    await waitFor(() => room.state.bubbles.size === 2, 1_000, 'second bubble')
    await waitConverged()
    const mine = room.state.players.get(extra.sessionId)?.bubbleId
    expect(mine).not.toBe('')
    expect(mine).not.toBe(bubble.id)
    expect(room.state.players.get(other.sessionId)?.bubbleId).toBe(mine)
    expect(bubble.members.length).toBe(n)
  })

  it('when someone leaves the room, those left nearby regroup without walking', async () => {
    await createRoom()
    const n = config.bubbleMaxMembers
    const inside: TestClient[] = []
    for (let i = 0; i < n; i++) inside.push(await connect(`m${i}`, 100 + i * 10, 100))
    const waiting = await connect('waiting', 100 + n * 10, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'one full bubble')
    const [bubble] = [...room.state.bubbles.values()]
    expect(bubble.members.length).toBe(n)
    expect(room.state.players.get(waiting.sessionId)?.bubbleId).toBe('')

    // One leaves the bubble: nobody walks, but whoever was waiting joins.
    const leaving = inside[0]
    const leavingSessionId = leaving.sessionId
    await leaving.leave(true)
    clients.splice(clients.indexOf(leaving), 1)
    await waitFor(
      () => room.state.players.get(waiting.sessionId)?.bubbleId !== '',
      1_000,
      'whoever was waiting joins',
    )
    expect(room.state.players.has(leavingSessionId)).toBe(false)
    expect(room.state.bubbles.size).toBe(1)
    expect([...room.state.bubbles.values()][0].members.length).toBe(n)
    // And whoever left is not inside any bubble.
    for (const [, bb] of room.state.bubbles.entries()) {
      expect([...bb.members]).not.toContain(leavingSessionId)
    }
    await waitConverged()
  })

  it('6. a fake position from the client neither creates nor breaks bubbles other than the ones the server computes', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'bubble of two')
    const [bubble] = [...room.state.bubbles.values()]
    const before = await waitConverged()

    // The protocol has no bubble message at all: membership is not requested.
    expect(Object.values(Message).some((type) => type.includes('bubble'))).toBe(false)

    // Non-numeric coordinates: they are ignored, the bubble neither moves nor breaks.
    b.send(Message.MOVE, { x: 'far', y: NaN })
    await room.waitForNextPatch().catch(() => {})
    expect(snapshot(room.state)).toBe(before)
    expect(room.state.bubbles.get(bubble.id)?.x).toBe(120)

    // A position outside the map is clamped BEFORE deciding the bubble: what
    // counts is the position clamped by the server, not the one the client
    // made up.
    const c = await connect('c', FAR.x, FAR.y)
    c.send(Message.MOVE, { x: -5_000, y: -5_000, dir: 'up', moving: false })
    await waitFor(
      () => room.state.players.get(c.sessionId)?.x === 0,
      1_000,
      'the server clamps to (0, 0)',
    )
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe('')
    expect(room.state.bubbles.size).toBe(1)

    // And if the clamping leaves them next to another, the bubble still comes from the server.
    await moveTo(a, 0, 0)
    await waitFor(
      () => room.state.players.get(c.sessionId)?.bubbleId !== '',
      1_000,
      'c ends up in a bubble with a at (0, 0)',
    )
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe(
      room.state.players.get(a.sessionId)?.bubbleId,
    )
    // Every client sees exactly what the server computed.
    await waitConverged()
  })
})
