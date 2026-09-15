import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as SdkRoom } from '@colyseus/sdk'
import {
  findSeats,
  isAtSeat,
  Message,
  PLAYER_BODY,
  playerStatus,
  roomNameFor,
  seatAnchor,
  type OfficeState,
  type Seat,
} from '@vto/shared'
import app from '../src/app.config'
import { worldMap } from '../src/map'
import type { WorldRoom } from '../src/rooms/WorldRoom'

type TestClient = SdkRoom<WorldRoom, OfficeState>

/** The world with the focus desks. */
const CHIRON = 'chiron-office'

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return Date.now() - started
}

/**
 * The focus desks of the Chiron Office, from the server's side.
 *
 * Sitting down is the only thing in this app that a client asks for and the
 * server decides: the position, the facing, who holds which desk and who is
 * "focused" are all written by the server alone, so what is tested here is
 * that no client can end up holding a desk it should not — by racing someone
 * else for it, by walking off with it, or by going away and leaving it
 * locked behind them.
 */
describe("A world's room: focus desks", () => {
  let colyseus: ColyseusTestServer
  let room: WorldRoom
  const clients: TestClient[] = []
  const seats: Seat[] = findSeats(worldMap(CHIRON).data)

  /** Far from every seat, so nothing here sits down by accident. */
  const FAR = { x: 220, y: 420 }

  async function createRoom() {
    room = await colyseus.createRoom<WorldRoom>(roomNameFor(CHIRON), {})
  }

  async function connect(name: string) {
    const client = await colyseus.connectTo(room, { name })
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    await client.waitForInitialState()
    return client
  }

  /** Sends the position and waits until the server has applied it. */
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

  const seatOf = (client: TestClient) => room.state.players.get(client.sessionId)?.seatId ?? ''

  /** Sits down and waits for the server to grant the seat. */
  async function sit(client: TestClient, seat: Seat) {
    client.send(Message.SIT, { seat: seat.name })
    await waitFor(() => seatOf(client) === seat.name, 1_000, `"${client.sessionId}" sits`)
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

  it('the world has the six focus desks the map declares', () => {
    expect(seats).toHaveLength(6)
  })

  it('sitting down pins you to the seat, facing the desk, and marks you focused', async () => {
    await createRoom()
    const a = await connect('a')
    await moveTo(a, FAR.x, FAR.y)
    expect(playerStatus(room.state.players.get(a.sessionId)!)).toBe('active')

    await sit(a, seats[0])

    const me = room.state.players.get(a.sessionId)!
    const anchor = seatAnchor(seats[0])
    expect({ x: me.x, y: me.y }).toEqual(anchor)
    expect(me.dir).toBe(seats[0].dir)
    expect(me.moving).toBe(false)
    expect(playerStatus(me)).toBe('focused')
  })

  it('everyone else sees who is sitting and where, and a late arrival sees it too', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await sit(a, seats[2])

    // Already in the room when it happened.
    await waitFor(
      () => b.state.players.get(a.sessionId)?.seatId === seats[2].name,
      1_000,
      'b sees a sitting',
    )
    // And someone who was not: seat occupancy is room state, not an event.
    const late = await connect('late')
    const seen = late.state.players.get(a.sessionId)!
    expect(seen.seatId).toBe(seats[2].name)
    expect({ x: seen.x, y: seen.y }).toEqual(seatAnchor(seats[2]))
    expect(playerStatus(seen)).toBe('focused')
  })

  it('a seat taken by one person cannot be taken by a second, until they stand up', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[1])

    b.send(Message.SIT, { seat: seats[1].name })
    // Nothing to wait for: the refusal is the state not changing. A round
    // trip through another message is enough to know it was processed.
    await moveTo(b, FAR.x + 1, FAR.y)
    expect(seatOf(b)).toBe('')
    expect(seatOf(a)).toBe(seats[1].name)

    a.send(Message.STAND, {})
    await waitFor(() => seatOf(a) === '', 1_000, 'a stands up')
    await sit(b, seats[1])
    expect(seatOf(b)).toBe(seats[1].name)
  })

  it('standing up returns you to active and frees the desk', async () => {
    await createRoom()
    const a = await connect('a')
    await sit(a, seats[3])

    a.send(Message.STAND, {})
    await waitFor(() => seatOf(a) === '', 1_000, 'a stands up')
    expect(playerStatus(room.state.players.get(a.sessionId)!)).toBe('active')
  })

  it('walking away from the desk stands you up', async () => {
    await createRoom()
    const a = await connect('a')
    await sit(a, seats[4])

    await moveTo(a, FAR.x, FAR.y)
    expect(seatOf(a)).toBe('')
    expect(playerStatus(room.state.players.get(a.sessionId)!)).toBe('active')
  })

  /**
   * A `MOVE` sent an instant before sitting down must not knock you straight
   * out of the chair. The seat is offered as soon as the player's *body*
   * overlaps it, so that stale position can be at the far rim of the overlap
   * — further from the anchor than the seat tile is wide. Standing up is
   * decided with the same body rectangle that offered the seat, so it cannot
   * disagree with the client about who is sitting where.
   */
  it('a move from anywhere the seat could be taken from does not stand you up', async () => {
    await createRoom()
    const a = await connect('a')
    const seat = seats[5]
    const anchor = seatAnchor(seat)

    // Every corner of the overlap: the furthest positions from which the
    // client would still have offered this seat.
    const rim = [
      { x: seat.x - PLAYER_BODY.width / 2 + 1, y: seat.y - PLAYER_BODY.height + 1 },
      { x: seat.x + seat.width + PLAYER_BODY.width / 2 - 1, y: seat.y - PLAYER_BODY.height + 1 },
      { x: seat.x - PLAYER_BODY.width / 2 + 1, y: seat.y + seat.height - 1 },
      { x: seat.x + seat.width + PLAYER_BODY.width / 2 - 1, y: seat.y + seat.height - 1 },
    ]
    for (const from of rim) {
      expect(
        isAtSeat(seat, from.x, from.y),
        `the seat is offered from ${JSON.stringify(from)}`,
      ).toBe(true)
      await sit(a, seat)
      a.send(Message.MOVE, { x: from.x, y: from.y, dir: 'up', moving: true })
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(seatOf(a), `stale move from ${JSON.stringify(from)} unseated them`).toBe(seat.name)
      // And the client's position did not win over the seat's.
      const me = room.state.players.get(a.sessionId)!
      expect({ x: me.x, y: me.y }).toEqual(anchor)

      a.send(Message.STAND, {})
      await waitFor(() => seatOf(a) === '', 1_000, 'a stands up')
    }
  })

  /**
   * Sitting again after having stood up has to work: the first version let a
   * stale `MOVE` free the seat the instant it was granted, and the symptom
   * was a chair that simply stopped accepting you.
   */
  it('you can sit down again after standing up', async () => {
    await createRoom()
    const a = await connect('a')
    const seat = seats[1]

    await sit(a, seat)
    await moveTo(a, FAR.x, FAR.y)
    expect(seatOf(a)).toBe('')

    // Back to the chair, approaching it the way someone walking would: the
    // last reported position is on the seat, then the request to sit.
    const anchor = seatAnchor(seat)
    await moveTo(a, anchor.x - 8, anchor.y + 4)
    await sit(a, seat)
    expect(seatOf(a)).toBe(seat.name)
  })

  it('marking yourself away while seated frees the desk', async () => {
    await createRoom()
    const a = await connect('a')
    await sit(a, seats[0])

    a.send(Message.SET_AWAY, { away: true })
    await waitFor(() => room.state.players.get(a.sessionId)?.away === true, 1_000, 'a is away')
    expect(seatOf(a)).toBe('')
    expect(playerStatus(room.state.players.get(a.sessionId)!)).toBe('away')
  })

  /**
   * Being heads-down without touching a key is what a focus desk is *for*, so
   * the inactivity sweep (1 s in the tests) must not evict whoever is sitting.
   */
  it('sitting still at a desk never turns into away by itself', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[0])

    await waitFor(() => room.state.players.get(b.sessionId)?.away === true, 4_000, 'b goes away')
    expect(room.state.players.get(a.sessionId)?.away).toBe(false)
    expect(seatOf(a)).toBe(seats[0].name)
  })

  it('leaving the room frees the desk for whoever comes next', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[2])

    await leaveQuietly(a)
    clients.splice(clients.indexOf(a), 1)
    await waitFor(() => !room.state.players.has(a.sessionId), 1_000, 'a leaves')
    await sit(b, seats[2])
    expect(seatOf(b)).toBe(seats[2].name)
  })

  it('a connection that drops without notice frees the desk while the seat is held', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[3])

    await a.leave(false) // closes the socket without notice: a network drop
    clients.splice(clients.indexOf(a), 1)
    await waitFor(
      () => room.state.players.get(a.sessionId)?.connected === false,
      1_000,
      'a is marked disconnected',
    )
    expect(seatOf(a)).toBe('')
    await sit(b, seats[3])
  })

  /**
   * The point of the whole feature: heads-down means nobody can start a
   * conversation with you. Bubbles are formed by the server on proximity, so
   * "unavailable" has to mean "forms no bubble", not a button being hidden.
   */
  it('nobody opens a conversation with someone who is focused', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[4])

    // Right next to them: well inside the bubble radius (64 px in the tests).
    const anchor = seatAnchor(seats[4])
    await moveTo(b, anchor.x + 24, anchor.y)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(room.state.bubbles.size).toBe(0)
    expect(room.state.players.get(a.sessionId)?.bubbleId).toBe('')
    expect(room.state.players.get(b.sessionId)?.bubbleId).toBe('')

    // Standing up makes them available again, without anyone walking.
    a.send(Message.STAND, {})
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'the bubble opens')
    expect(room.state.players.get(a.sessionId)?.bubbleId).not.toBe('')
    expect(room.state.players.get(b.sessionId)?.bubbleId).not.toBe('')
  })

  it('sitting down leaves the conversation you were in', async () => {
    await createRoom()
    const a = await connect('a')
    const b = await connect('b')
    const anchor = seatAnchor(seats[5])
    await moveTo(a, anchor.x, anchor.y)
    await moveTo(b, anchor.x + 24, anchor.y)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'they are talking')

    await sit(a, seats[5])
    await waitFor(() => room.state.bubbles.size === 0, 1_000, 'the conversation closes')
    expect(room.state.players.get(a.sessionId)?.bubbleId).toBe('')
    expect(room.state.players.get(b.sessionId)?.bubbleId).toBe('')
  })

  /**
   * Going back through the door while sitting. Travelling is leaving this
   * room and joining the other world's, so the seat has to be free the
   * instant you are gone, and you have to arrive standing — nobody carries a
   * desk from one world into another.
   */
  it('leaving through a door frees the desk and you arrive standing', async () => {
    await createRoom()
    const first = await colyseus.createRoom<WorldRoom>(roomNameFor('first-office'), {})
    const a = await connect('a')
    const b = await connect('b')
    await moveTo(b, FAR.x, FAR.y)
    await sit(a, seats[0])

    // What the client does when it crosses a door: join the destination, then
    // leave the origin (see `OfficeConnection.travelTo`).
    const arrived = await colyseus.connectTo(first, { name: 'a', spawn: 'from-chiron' })
    arrived.reconnection.enabled = false
    arrived.onMessage(Message.ROOM_INFO, () => {})
    clients.push(arrived)
    await arrived.waitForInitialState()
    await leaveQuietly(a)
    clients.splice(clients.indexOf(a), 1)

    await waitFor(() => !room.state.players.has(a.sessionId), 2_000, 'a leaves Chiron')
    expect(playerStatus(first.state.players.get(arrived.sessionId)!)).toBe('active')
    expect(first.state.players.get(arrived.sessionId)?.seatId).toBe('')
    // And the desk is free for whoever is still in the Chiron Office.
    await sit(b, seats[0])
  })

  it('a seat that is not in this map is refused', async () => {
    await createRoom()
    const a = await connect('a')
    await moveTo(a, FAR.x, FAR.y)

    a.send(Message.SIT, { seat: 'a seat that does not exist' })
    await moveTo(a, FAR.x + 1, FAR.y)
    expect(seatOf(a)).toBe('')
  })
})
