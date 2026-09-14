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
 * Viajar entre mundos: cada mundo es su propia sala, así que "cruzar la
 * puerta" es salir de una y entrar a la otra con el nombre del spawn de
 * llegada. Acá se prueba lo que garantiza el servidor de ese viaje: dónde
 * aparece quien llega, qué se lleva puesto, y que nada (ni la gente ni el
 * chat) cruce de un mundo al otro.
 */
describe('Mundos conectados por puertas', () => {
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
      if (Date.now() - started > timeoutMs) throw new Error(`Timeout esperando: ${label}`)
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

  it('cada mundo levanta su propio mapa', async () => {
    await createWorlds()
    expect(first.world.id).toBe(FIRST)
    expect(chiron.world.id).toBe(CHIRON)
    expect(first.map.file).not.toBe(chiron.map.file)
    expect(first.map.bounds).not.toEqual(chiron.map.bounds)
  })

  it('quien llega por una puerta aparece en el spawn que esa puerta nombra, mirando hacia adentro', async () => {
    await createWorlds()
    const traveller = await connect(chiron, { name: 'Dami', spawn: 'desde-first-office' })

    const arrival = findSpawnPoint(chiron.map.data, 'desde-first-office')
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(Math.hypot(me.x - arrival.x, me.y - arrival.y)).toBeLessThanOrEqual(arrival.radius)
    expect(me.dir).toBe(arrival.dir)
    expect(me.name).toBe('Dami')
  })

  it('un spawn que el mundo no conoce cae en la entrada en vez de romper', async () => {
    await createWorlds()
    const traveller = await connect(chiron, { spawn: 'una-puerta-que-no-existe' })
    const entry = chiron.map.spawn
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(Math.hypot(me.x - entry.x, me.y - entry.y)).toBeLessThanOrEqual(entry.radius)
  })

  it('el estado ausente viaja con el jugador', async () => {
    await createWorlds()
    const traveller = await connect(chiron, {
      spawn: 'desde-first-office',
      away: true,
      awayManual: true,
    })
    const me = chiron.state.players.get(traveller.sessionId)!
    expect(me.away).toBe(true)
    expect(me.awayManual).toBe(true)
  })

  it('los que se quedan dejan de ver al que viaja y los del destino lo ven llegar', async () => {
    await createWorlds()
    const stays = await connect(first, { name: 'Se queda' })
    const traveller = await connect(first, { name: 'Viaja' })
    const already = await connect(chiron, { name: 'Ya estaba' })
    await waitFor(() => stays.state.players.size === 2, 500, 'los dos en la First Office')

    // Viajar: se entra al destino y se sale del origen (como hace el cliente).
    const arrived = await connect(chiron, { name: 'Viaja', spawn: 'desde-first-office' })
    await leaveQuietly(traveller)

    await waitFor(() => stays.state.players.size === 1, 1_000, 'el viajero se fue de la First')
    expect([...stays.state.players.values()].map((p) => p.name)).toEqual(['Se queda'])

    await waitFor(() => already.state.players.size === 2, 1_000, 'el viajero llegó a Chiron')
    expect([...already.state.players.values()].map((p) => p.name).sort()).toEqual([
      'Viaja',
      'Ya estaba',
    ])
    expect(already.state.players.has(arrived.sessionId)).toBe(true)
  })

  it('el chat de un mundo no llega al otro, aunque estén en las mismas coordenadas', async () => {
    await createWorlds()
    const here = await connect(first, { name: 'Acá' })
    const alsoHere = await connect(first, { name: 'También acá' })
    const faraway = await connect(chiron, { name: 'En Chiron' })

    const received: ChatMessagePayload[] = []
    const crossed: ChatMessagePayload[] = []
    alsoHere.onMessage(Message.CHAT_MESSAGE, (m) => received.push(m))
    faraway.onMessage(Message.CHAT_MESSAGE, (m) => crossed.push(m))

    // Los tres en el mismo punto: en la First Office eso es una burbuja; el de
    // Chiron está en otra sala, así que no comparte nada.
    for (const client of [here, alsoHere]) {
      client.send(Message.MOVE, { x: 400, y: 400, dir: 'down', moving: false })
    }
    faraway.send(Message.MOVE, { x: 400, y: 400, dir: 'down', moving: false })
    // Los dos de la First Office tienen que estar en la MISMA burbuja antes de
    // hablar: si uno todavía no llegó, el servidor rechaza el mensaje por no
    // tener con quién conversar.
    await waitFor(
      () => {
        const mine = here.state.players.get(here.sessionId)
        const theirs = here.state.players.get(alsoHere.sessionId)
        // Los dos ya en el punto acordado (el estado inicial también los pone
        // juntos en la entrada) y en la misma burbuja.
        const arrived = mine?.x === 400 && mine.y === 400 && theirs?.x === 400 && theirs.y === 400
        return arrived && !!mine?.bubbleId && mine.bubbleId === theirs?.bubbleId
      },
      1_000,
      'burbuja compartida en la First Office',
    )
    expect(faraway.state.bubbles.size).toBe(0)

    here.send(Message.CHAT_SEND, { id: 'm1', text: 'hola vecinos' })
    await waitFor(() => received.length === 1, 1_000, 'el mensaje llegó a la burbuja')
    expect(received[0].text).toBe('hola vecinos')
    // Margen para que un mensaje mal ruteado tuviera tiempo de llegar.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(crossed).toEqual([])
  })

  it('si el mundo destino no está en pie, entrar falla y el jugador se queda donde está', async () => {
    await createWorlds()
    const stays = await connect(first, { name: 'Se queda' })
    await chiron.disconnect()

    // `join` (lo que usa el cliente al viajar) no levanta un mundo apagado.
    await expect(
      colyseus.sdk.join(roomNameFor(CHIRON), { spawn: 'desde-first-office' }),
    ).rejects.toBeTruthy()
    expect(first.state.players.has(stays.sessionId)).toBe(true)
  })
})
