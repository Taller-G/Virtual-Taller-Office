import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as SdkRoom } from '@colyseus/sdk'
import {
  findSpawnPoint,
  Message,
  roomNameFor,
  type ChatMessagePayload,
  type JoinOptions,
  type OfficeState,
} from '@vto/shared'
import app from '../src/app.config'
import type { WorldRoom } from '../src/rooms/WorldRoom'

type TestClient = SdkRoom<WorldRoom, OfficeState>

const FIRST = 'first-office'
const CHIRON = 'chiron-office'

/**
 * Travelling between worlds: each world is its own room, so "crossing the
 * door" is leaving one and joining the other with the name of the arrival
 * spawn. What is tested here is what the server guarantees about that trip:
 * where the arriving player appears, what they bring with them, and that
 * nothing (neither people nor chat) crosses from one world to the other.
 */
describe('Worlds connected by doors', () => {
  let colyseus: ColyseusTestServer
  let first: WorldRoom
  let chiron: WorldRoom
  const clients: TestClient[] = []

  async function connect(room: WorldRoom, options?: JoinOptions) {
    const client = (await colyseus.connectTo(room, options)) as TestClient
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    await client.waitForInitialState()
    return client
  }

  async function leaveQuietly(client: TestClient) {
    await Promise.race([
      client.leave(true).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
  }

  async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
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

  async function createWorlds() {
    first = await colyseus.createRoom<WorldRoom>(roomNameFor(FIRST), {})
    chiron = await colyseus.createRoom<WorldRoom>(roomNameFor(CHIRON), {})
  }

  it('each world brings up its own map', async () => {
    await createWorlds()
    expect(first.world.id).toBe(FIRST)
    expect(chiron.world.id).toBe(CHIRON)
    expect(first.map.file).not.toBe(chiron.map.file)
    expect(first.map.bounds).not.toEqual(chiron.map.bounds)
  })

  it('whoever arrives through a door appears at the spawn that door names, facing inwards', async () => {
    await createWorlds()
    const traveller = await connect(chiron, { name: 'Dami', spawn: 'from-first-office' })

    const arrival = findSpawnPoint(chiron.map.data, 'from-first-office')
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(Math.hypot(me.x - arrival.x, me.y - arrival.y)).toBeLessThanOrEqual(arrival.radius)
    expect(me.dir).toBe(arrival.dir)
    expect(me.name).toBe('Dami')
  })

  it('a spawn the world does not know falls back to the entrance instead of breaking', async () => {
    await createWorlds()
    const traveller = await connect(chiron, { spawn: 'a-door-that-does-not-exist' })
    const entry = chiron.map.spawn
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(Math.hypot(me.x - entry.x, me.y - entry.y)).toBeLessThanOrEqual(entry.radius)
  })

  it('the away state travels with the player', async () => {
    await createWorlds()
    const traveller = await connect(chiron, {
      spawn: 'from-first-office',
      away: true,
      awayManual: true,
    })
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(me.away).toBe(true)
    expect(me.awayManual).toBe(true)
  })

  it('those who stay stop seeing the traveller and those at the destination see them arrive', async () => {
    await createWorlds()
    const stays = await connect(first, { name: 'Stays' })
    const traveller = await connect(first, { name: 'Travels' })
    const already = await connect(chiron, { name: 'Was here' })
    await waitFor(() => stays.state.players.size === 2, 500, 'both in the First Office')

    // Travelling: join the destination and leave the origin (as the client does).
    const arrived = await connect(chiron, { name: 'Travels', spawn: 'from-first-office' })
    await leaveQuietly(traveller)

    await waitFor(() => stays.state.players.size === 1, 1_000, 'the traveller left the First')
    expect([...stays.state.players.values()].map((p) => p.name)).toEqual(['Stays'])

    await waitFor(() => already.state.players.size === 2, 1_000, 'the traveller arrived in Chiron')
    expect([...already.state.players.values()].map((p) => p.name).sort()).toEqual([
      'Travels',
      'Was here',
    ])
    expect(already.state.players.has(arrived.sessionId)).toBe(true)
  })

  it('the chat of one world does not reach the other, even at the same coordinates', async () => {
    await createWorlds()
    const here = await connect(first, { name: 'Here' })
    const alsoHere = await connect(first, { name: 'Also here' })
    const faraway = await connect(chiron, { name: 'In Chiron' })

    const received: ChatMessagePayload[] = []
    const crossed: ChatMessagePayload[] = []
    alsoHere.onMessage(Message.CHAT_MESSAGE, (m) => received.push(m))
    faraway.onMessage(Message.CHAT_MESSAGE, (m) => crossed.push(m))

    // All three at the same point: in the First Office that is a bubble; the
    // one in Chiron is in another room, so they share nothing.
    for (const client of [here, alsoHere]) {
      client.send(Message.MOVE, { x: 400, y: 400, dir: 'down', moving: false })
    }
    faraway.send(Message.MOVE, { x: 400, y: 400, dir: 'down', moving: false })
    // The two in the First Office have to be in the SAME bubble before
    // talking: if one has not arrived yet, the server rejects the message for
    // having nobody to converse with.
    await waitFor(
      () => {
        const mine = here.state.players.get(here.sessionId)
        const theirs = here.state.players.get(alsoHere.sessionId)
        // Both already at the agreed point (the initial state also puts them
        // together at the entrance) and in the same bubble.
        const arrived = mine?.x === 400 && mine.y === 400 && theirs?.x === 400 && theirs.y === 400
        return arrived && !!mine?.bubbleId && mine.bubbleId === theirs?.bubbleId
      },
      1_000,
      'shared bubble in the First Office',
    )
    expect(faraway.state.bubbles.size).toBe(0)

    here.send(Message.CHAT_SEND, { id: 'm1', text: 'hi neighbours' })
    await waitFor(() => received.length === 1, 1_000, 'the message reached the bubble')
    expect(received[0].text).toBe('hi neighbours')
    // Margin so that a misrouted message would have had time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(crossed).toEqual([])
  })

  it('if the destination world is not up, joining fails and the player stays where they are', async () => {
    await createWorlds()
    const stays = await connect(first, { name: 'Stays' })
    await chiron.disconnect()

    // `join` (what the client uses when travelling) does not bring up a world that is down.
    await expect(
      colyseus.sdk.join(roomNameFor(CHIRON), { spawn: 'from-first-office' }),
    ).rejects.toBeTruthy()
    expect(first.state.players.has(stays.sessionId)).toBe(true)
  })
})
