import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import { CloseCode, type Room as SdkRoom } from '@colyseus/sdk'
import {
  DEFAULT_AVATAR,
  DEFAULT_WORLD_ID,
  Message,
  NAME_MAX_LENGTH,
  roomNameFor,
  type JoinOptions,
  type OfficeState,
} from '@vto/shared'
import app from '../src/app.config'
import { config } from '../src/config'
import type { WorldRoom } from '../src/rooms/WorldRoom'

/** Waits until `predicate` is true or `timeoutMs` expires. */
async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return Date.now() - started
}

describe('A world\'s room: connect / disconnect cycle', () => {
  let colyseus: ColyseusTestServer
  let room: WorldRoom
  const clients: SdkRoom<WorldRoom, OfficeState>[] = []

  async function connect(options?: JoinOptions) {
    const client = await colyseus.connectTo(room, options)
    // The tests control disconnection by hand; the SDK's automatic retry
    // would muddle the "it dropped and never came back" scenarios.
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    return client
  }

  /** Consented leave with a cap: an already-closed client would never resolve `leave()`. */
  async function leaveQuietly(client: SdkRoom<WorldRoom, OfficeState>) {
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

  it('on joining it receives its sessionId and the state with its own player', async () => {
    await createRoom()
    const client = await connect()
    await client.waitForInitialState()

    expect(client.sessionId).toBe(room.clients[0].sessionId)
    expect(room.state.players.has(client.sessionId)).toBe(true)
    const me = client.state.players.get(client.sessionId)
    expect(me?.sessionId).toBe(client.sessionId)
    expect(me?.connected).toBe(true)
  })

  it('two clients join the same room and see each other', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await room.waitForNextPatch()
    await waitFor(
      () => a.state.players.size === 2 && b.state.players.size === 2,
      2_000,
      'both see 2',
    )

    expect(room.state.players.size).toBe(2)
    expect(a.state.players.has(b.sessionId)).toBe(true)
    expect(b.state.players.has(a.sessionId)).toBe(true)
  })

  it('a consented leave (closing the tab) removes the player immediately', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a sees 2')

    const code = await b.leave(true)
    expect(code).toBe(CloseCode.CONSENTED)

    const elapsed = await waitFor(() => room.state.players.size === 1, 1_000, 'server removes b')
    await waitFor(() => a.state.players.size === 1, 1_000, 'a sees that b left')
    expect(elapsed).toBeLessThan(1_000)
    expect(room.state.players.has(a.sessionId)).toBe(true)
  })

  it('a disconnection without notice removes the player in under 3 seconds', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a sees 2')

    const dropped = b.sessionId
    await b.leave(false) // closes the socket without notice: simulates a network drop

    // During the grace period the player stays but is marked as disconnected.
    await waitFor(() => room.state.players.get(dropped)?.connected === false, 1_000, 'marked')

    const elapsed = await waitFor(
      () => !room.state.players.has(dropped),
      3_000,
      'server removes them',
    )
    expect(elapsed).toBeLessThan(3_000)
    expect(elapsed).toBeGreaterThanOrEqual(config.reconnectGraceSeconds * 1000 - 200)
    await waitFor(() => a.state.players.size === 1, 1_000, 'a sees that b left')
  })

  it('reconnecting within the grace period keeps the same session without duplicates', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a sees 2')

    const token = b.reconnectionToken
    const sessionId = b.sessionId
    await b.leave(false)
    await waitFor(() => room.state.players.get(sessionId)?.connected === false, 1_000, 'marked')

    const again = await colyseus.sdk.reconnect<WorldRoom>(token)
    again.reconnection.enabled = false
    clients.push(again)

    expect(again.sessionId).toBe(sessionId)
    await waitFor(() => room.state.players.get(sessionId)?.connected === true, 1_000, 'reconnected')
    expect(room.state.players.size).toBe(2)
    await waitFor(() => a.state.players.size === 2, 1_000, 'a still sees 2')
  })

  it('refreshing several times leaves exactly one player per browser', async () => {
    await createRoom()
    const observer = await connect()

    let current = await connect()
    for (let i = 0; i < 5; i++) {
      await current.leave(true) // the client does a consented leave on pagehide
      current = await connect()
    }

    await waitFor(() => room.state.players.size === 2, 2_000, 'observer + 1 player')
    await waitFor(() => observer.state.players.size === 2, 2_000, 'observer sees 2')
    expect(room.state.players.has(current.sessionId)).toBe(true)
  })

  it('the player appears at the spawn point defined in the map', async () => {
    await createRoom()
    const client = await connect()
    await client.waitForInitialState()

    const me = room.state.players.get(client.sessionId)!
    const { spawn } = room.map
    const distance = Math.hypot(me.x - spawn.x, me.y - spawn.y)
    expect(distance).toBeLessThanOrEqual(spawn.radius + 1)
  })

  it('a move message updates the position and clamps it to the map', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b sees 2')

    a.send(Message.MOVE, { x: 300, y: 200, dir: 'left', moving: true })
    await waitFor(() => room.state.players.get(a.sessionId)?.x === 300, 1_000, 'server moves them')
    await waitFor(() => b.state.players.get(a.sessionId)?.y === 200, 1_000, 'b sees the movement')
    expect(b.state.players.get(a.sessionId)?.dir).toBe('left')
    expect(b.state.players.get(a.sessionId)?.moving).toBe(true)

    a.send(Message.MOVE, { x: 300, y: 200, dir: 'diagonal', moving: 'yes' })
    await room.waitForNextPatch().catch(() => {})
    // Invalid direction: the previous one is kept; moving only accepts `true`.
    expect(room.state.players.get(a.sessionId)?.dir).toBe('left')
    expect(room.state.players.get(a.sessionId)?.moving).toBe(false)

    a.send(Message.MOVE, { x: -50, y: 99_999 })
    await waitFor(() => room.state.players.get(a.sessionId)?.x === 0, 1_000, 'clamped in x')
    expect(room.state.players.get(a.sessionId)?.y).toBe(room.map.bounds.height)

    a.send(Message.MOVE, { x: 'nope', y: NaN })
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(a.sessionId)?.x).toBe(0)
  })

  it('joins with the chosen name and avatar, and everyone sees them', async () => {
    await createRoom()
    const observer = await connect()
    const client = await connect({ name: '  Constantino   Strada  ', avatar: 'iris' })
    await client.waitForInitialState()

    const me = room.state.players.get(client.sessionId)!
    expect(me.name).toBe('Constantino Strada')
    expect(me.avatar).toBe('iris')
    expect(me.dir).toBe('down')
    expect(me.moving).toBe(false)
    expect(me.away).toBe(false)
    await waitFor(
      () => observer.state.players.get(client.sessionId)?.name === 'Constantino Strada',
      1_000,
      'the observer sees the name',
    )
    expect(observer.state.players.get(client.sessionId)?.avatar).toBe('iris')
  })

  it('invalid options fall back to a guest name, the default avatar and a capped name', async () => {
    await createRoom()
    const anon = await connect({ name: '   ', avatar: 'pikachu' })
    const long = await connect({ name: 'x'.repeat(NAME_MAX_LENGTH + 10), avatar: 42 as never })
    await long.waitForInitialState()

    expect(room.state.players.get(anon.sessionId)?.name).toBe(
      `Guest-${anon.sessionId.slice(0, 4)}`,
    )
    expect(room.state.players.get(anon.sessionId)?.avatar).toBe(DEFAULT_AVATAR)
    expect(room.state.players.get(long.sessionId)?.name).toBe('x'.repeat(NAME_MAX_LENGTH))
    expect(room.state.players.get(long.sessionId)?.avatar).toBe(DEFAULT_AVATAR)
  })

  it('changing the name is replicated; an empty name is ignored', async () => {
    await createRoom()
    const a = await connect({ name: 'Ana' })
    const b = await connect()
    await waitFor(() => b.state.players.get(a.sessionId)?.name === 'Ana', 1_000, 'b sees Ana')

    a.send(Message.SET_NAME, { name: 'Ana Maria' })
    await waitFor(() => b.state.players.get(a.sessionId)?.name === 'Ana Maria', 1_000, 'renamed')

    a.send(Message.SET_NAME, { name: '   ' })
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(a.sessionId)?.name).toBe('Ana Maria')
  })

  it('without activity it becomes "away" and on moving it goes back to "active"', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b sees 2')
    expect(room.state.players.get(a.sessionId)?.away).toBe(false)

    // AWAY_AFTER_SECONDS=1 in vitest.config.ts; the check runs every 1 s.
    const elapsed = await waitFor(
      () => b.state.players.get(a.sessionId)?.away === true,
      3_500,
      'b sees a as away',
    )
    expect(elapsed).toBeGreaterThanOrEqual(config.awayAfterSeconds * 1000 - 200)
    expect(room.state.players.get(a.sessionId)?.awayManual).toBe(false)

    a.send(Message.MOVE, { x: 400, y: 300, dir: 'right', moving: true })
    await waitFor(
      () => b.state.players.get(a.sessionId)?.away === false,
      1_000,
      'a goes back to active',
    )
  })

  it('the manual "away" is set and cleared by hand, and moving does not clear it', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b sees 2')

    a.send(Message.SET_AWAY, { away: true })
    await waitFor(() => b.state.players.get(a.sessionId)?.away === true, 1_000, 'b sees away')
    expect(b.state.players.get(a.sessionId)?.awayManual).toBe(true)

    a.send(Message.MOVE, { x: 400, y: 300, dir: 'up', moving: true })
    await waitFor(() => b.state.players.get(a.sessionId)?.x === 400, 1_000, 'b sees the movement')
    expect(b.state.players.get(a.sessionId)?.away).toBe(true)

    a.send(Message.SET_AWAY, { away: false })
    await waitFor(() => b.state.players.get(a.sessionId)?.away === false, 1_000, 'b sees active')
    expect(b.state.players.get(a.sessionId)?.awayManual).toBe(false)
  })
})
