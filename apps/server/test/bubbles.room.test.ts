import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as SdkRoom } from '@colyseus/sdk'
import { Message, ROOM_NAME, type OfficeState } from '@vto/shared'
import app from '../src/app.config'
import { config } from '../src/config'
import type { OficinaTallerRoom } from '../src/rooms/OficinaTallerRoom'

type TestClient = SdkRoom<OficinaTallerRoom, OfficeState>

/** Espera hasta que `predicate` sea verdadera o venza `timeoutMs`; devuelve los ms que tardó. */
async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout esperando: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return Date.now() - started
}

/**
 * Todo lo que define "quién está en qué burbuja", en forma comparable: las
 * burbujas con sus miembros y el `bubbleId` de cada jugador. Sirve igual para
 * el estado del servidor y para el de cualquier cliente, así se puede exigir
 * que coincidan exactamente.
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

describe('Sala "Oficina Taller": burbujas de conversación por proximidad', () => {
  let colyseus: ColyseusTestServer
  let room: OficinaTallerRoom
  const clients: TestClient[] = []
  /** BUBBLE_RADIUS_PX en vitest.config.ts (2 tiles de 32 px). */
  const RADIUS = 64
  /** Lejos del spawn del mapa (848, 208) y de las posiciones de prueba. */
  const FAR = { x: 300, y: 700 }

  async function connect(name: string, x: number, y: number) {
    const client = await colyseus.connectTo(room, { name })
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    await client.waitForInitialState()
    // Cada jugador arranca en un lugar controlado, no en el spawn del mapa.
    await moveTo(client, x, y)
    return client
  }

  /** Manda la posición y espera a que el servidor la haya aplicado (x **e** y). */
  function moveTo(client: TestClient, x: number, y: number) {
    client.send(Message.MOVE, { x, y, dir: 'down', moving: false })
    return waitFor(
      () => {
        const player = room.state.players.get(client.sessionId)
        return player?.x === x && player?.y === y
      },
      1_000,
      `el servidor mueve a "${client.sessionId}" a (${x}, ${y})`,
    )
  }

  /** Espera a que todos los clientes vean exactamente las burbujas del servidor. */
  async function waitConverged(timeoutMs = 1_000) {
    const expected = snapshot(room.state)
    for (const client of clients) {
      await waitFor(
        () => snapshot(client.state) === expected,
        timeoutMs,
        `"${client.sessionId}" converge con el servidor`,
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
    room = await colyseus.createRoom<OficinaTallerRoom>(ROOM_NAME, {})
  }

  it('radio y tope salen de la configuración y se replican a los clientes', async () => {
    await createRoom()
    expect(room.bubbles.radius).toBe(RADIUS)
    expect(room.bubbles.maxMembers).toBe(config.bubbleMaxMembers)
    const a = await connect('a', 100, 100)
    expect(a.state.bubbleRadius).toBe(RADIUS)
    expect(a.state.bubbleMaxMembers).toBe(config.bubbleMaxMembers)
  })

  it('1. dos jugadores que se acercan ven la misma burbuja en ambos clientes en menos de 300 ms', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', FAR.x, FAR.y)
    expect(room.state.bubbles.size).toBe(0)

    const started = Date.now()
    b.send(Message.MOVE, { x: 100 + RADIUS, y: 100, dir: 'left', moving: true })
    // Que ambos vean una burbuja es un cambio de 0 a 1: no puede dar falso positivo.
    await waitFor(
      () => a.state.bubbles.size === 1 && b.state.bubbles.size === 1,
      300,
      'ambos la ven',
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
      // El centro es el baricentro de los dos.
      expect(seen.x).toBe(100 + RADIUS / 2)
      expect(seen.y).toBe(100)
    }
  })

  it('2. un tercero que se acerca entra en la misma burbuja y los tres ven tres miembros', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'burbuja de a y b')
    const [bubble] = [...room.state.bubbles.values()]
    const c = await connect('c', FAR.x, FAR.y)
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe('')

    await moveTo(c, 120, 100 + RADIUS)
    await waitFor(() => bubble.members.length === 3, 1_000, 'el servidor suma a c')
    await waitConverged()

    for (const client of [a, b, c]) {
      const seen = client.state.bubbles.get(bubble.id)!
      expect(seen.members.length).toBe(3)
      expect([...seen.members].sort()).toEqual([a.sessionId, b.sessionId, c.sessionId].sort())
      expect(client.state.players.get(c.sessionId)?.bubbleId).toBe(bubble.id)
    }
    expect(room.state.bubbles.size).toBe(1)
  })

  it('3. al alejarse uno, sale de la burbuja; los otros dos siguen adentro', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    const c = await connect('c', 120, 140)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'una burbuja')
    const [bubble] = [...room.state.bubbles.values()]
    await waitFor(() => bubble.members.length === 3, 1_000, 'burbuja de tres')

    await moveTo(c, 120, 500)
    await waitFor(
      () => room.state.players.get(c.sessionId)?.bubbleId === '',
      1_000,
      'el servidor saca a c',
    )
    await waitConverged()

    for (const client of [a, b, c]) {
      const seen = client.state.bubbles.get(bubble.id)!
      expect([...seen.members].sort()).toEqual([a.sessionId, b.sessionId].sort())
      expect(client.state.players.get(a.sessionId)?.bubbleId).toBe(bubble.id)
      expect(client.state.players.get(b.sessionId)?.bubbleId).toBe(bubble.id)
      expect(client.state.players.get(c.sessionId)?.bubbleId).toBe('')
      // El centro vuelve a ser el de los dos que quedaron.
      expect(seen.x).toBe(120)
      expect(seen.y).toBe(100)
    }
  })

  it('4. cuando queda uno solo, la burbuja desaparece para él', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'burbuja de dos')

    await moveTo(b, FAR.x, FAR.y)
    await waitFor(() => room.state.bubbles.size === 0, 1_000, 'el servidor la destruye')
    await waitConverged()
    for (const client of [a, b]) {
      expect(client.state.bubbles.size).toBe(0)
      expect(client.state.players.get(a.sessionId)?.bubbleId).toBe('')
      expect(client.state.players.get(b.sessionId)?.bubbleId).toBe('')
    }

    // Lo mismo si el otro se va de la sala en vez de alejarse.
    const c = await connect('c', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'burbuja con c')
    await c.leave(true)
    clients.splice(clients.indexOf(c), 1)
    await waitFor(() => room.state.bubbles.size === 0, 1_000, 'se destruye al irse c')
    await waitConverged()
    expect(a.state.bubbles.size).toBe(0)
    expect(a.state.players.get(a.sessionId)?.bubbleId).toBe('')
  })

  it('5. con el tope en N, el jugador N+1 que se acerca no entra y ve la burbuja llena', async () => {
    await createRoom()
    const n = config.bubbleMaxMembers
    const members: TestClient[] = []
    for (let i = 0; i < n; i++) {
      // En un círculo chico alrededor de (100, 100): todos dentro del radio.
      const angle = (i / n) * Math.PI * 2
      members.push(
        await connect(
          `m${i}`,
          Math.round(100 + Math.cos(angle) * 10),
          Math.round(100 + Math.sin(angle) * 10),
        ),
      )
    }
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'una burbuja')
    const [bubble] = [...room.state.bubbles.values()]
    await waitFor(() => bubble.members.length === n, 1_000, `burbuja llena (${n})`)

    const extra = await connect('extra', FAR.x, FAR.y)
    await moveTo(extra, 104, 104)
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(extra.sessionId)?.bubbleId).toBe('')
    expect(bubble.members.length).toBe(n)
    expect(room.state.bubbles.size).toBe(1)
    await waitConverged()

    // Lo que el cliente usa para mostrar "burbuja llena": no tengo burbuja, y la
    // que tengo al alcance está al tope, con el mismo radio y tope del servidor.
    const me = extra.state.players.get(extra.sessionId)!
    const seen = extra.state.bubbles.get(bubble.id)!
    expect(me.bubbleId).toBe('')
    expect(Math.hypot(me.x - seen.x, me.y - seen.y)).toBeLessThanOrEqual(extra.state.bubbleRadius)
    expect(seen.members.length).toBe(extra.state.bubbleMaxMembers)

    // Dos que sobran arman su propia burbuja en vez de entrar a la llena.
    const other = await connect('otro', FAR.x, FAR.y)
    await moveTo(other, 108, 108)
    await waitFor(() => room.state.bubbles.size === 2, 1_000, 'segunda burbuja')
    await waitConverged()
    const mine = room.state.players.get(extra.sessionId)?.bubbleId
    expect(mine).not.toBe('')
    expect(mine).not.toBe(bubble.id)
    expect(room.state.players.get(other.sessionId)?.bubbleId).toBe(mine)
    expect(bubble.members.length).toBe(n)
  })

  it('cuando alguien se va de la sala, los que quedan cerca se reagrupan sin caminar', async () => {
    await createRoom()
    const n = config.bubbleMaxMembers
    const inside: TestClient[] = []
    for (let i = 0; i < n; i++) inside.push(await connect(`m${i}`, 100 + i * 10, 100))
    const waiting = await connect('espera', 100 + n * 10, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'una burbuja llena')
    const [bubble] = [...room.state.bubbles.values()]
    expect(bubble.members.length).toBe(n)
    expect(room.state.players.get(waiting.sessionId)?.bubbleId).toBe('')

    // Se va uno de la burbuja: nadie camina, pero el que esperaba entra.
    const leaving = inside[0]
    const leavingSessionId = leaving.sessionId
    await leaving.leave(true)
    clients.splice(clients.indexOf(leaving), 1)
    await waitFor(
      () => room.state.players.get(waiting.sessionId)?.bubbleId !== '',
      1_000,
      'el que esperaba entra',
    )
    expect(room.state.players.has(leavingSessionId)).toBe(false)
    expect(room.state.bubbles.size).toBe(1)
    expect([...room.state.bubbles.values()][0].members.length).toBe(n)
    // Y el que se fue no quedó dentro de ninguna burbuja.
    for (const [, bb] of room.state.bubbles.entries()) {
      expect([...bb.members]).not.toContain(leavingSessionId)
    }
    await waitConverged()
  })

  it('6. una posición falsa del cliente no crea ni rompe burbujas distintas a las que calcula el servidor', async () => {
    await createRoom()
    const a = await connect('a', 100, 100)
    const b = await connect('b', 140, 100)
    await waitFor(() => room.state.bubbles.size === 1, 1_000, 'burbuja de dos')
    const [bubble] = [...room.state.bubbles.values()]
    const before = await waitConverged()

    // El protocolo no tiene ningún mensaje de burbujas: la membresía no se pide.
    expect(Object.values(Message).some((type) => type.includes('bubble'))).toBe(false)

    // Coordenadas no numéricas: se ignoran, la burbuja no se mueve ni se rompe.
    b.send(Message.MOVE, { x: 'lejos', y: NaN })
    await room.waitForNextPatch().catch(() => {})
    expect(snapshot(room.state)).toBe(before)
    expect(room.state.bubbles.get(bubble.id)?.x).toBe(120)

    // Una posición fuera del mapa se acota ANTES de decidir la burbuja: manda
    // la posición acotada por el servidor, no la que inventó el cliente.
    const c = await connect('c', FAR.x, FAR.y)
    c.send(Message.MOVE, { x: -5_000, y: -5_000, dir: 'up', moving: false })
    await waitFor(
      () => room.state.players.get(c.sessionId)?.x === 0,
      1_000,
      'el servidor acota a (0, 0)',
    )
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe('')
    expect(room.state.bubbles.size).toBe(1)

    // Y si el recorte lo deja pegado a otro, la burbuja sale igual del servidor.
    await moveTo(a, 0, 0)
    await waitFor(
      () => room.state.players.get(c.sessionId)?.bubbleId !== '',
      1_000,
      'c queda en burbuja con a en (0, 0)',
    )
    expect(room.state.players.get(c.sessionId)?.bubbleId).toBe(
      room.state.players.get(a.sessionId)?.bubbleId,
    )
    // Todos los clientes ven exactamente lo que calculó el servidor.
    await waitConverged()
  })
})
