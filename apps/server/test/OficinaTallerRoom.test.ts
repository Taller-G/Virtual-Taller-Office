import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import { CloseCode, type Room as SdkRoom } from '@colyseus/sdk'
import {
  DEFAULT_AVATAR,
  Message,
  NAME_MAX_LENGTH,
  ROOM_NAME,
  type JoinOptions,
  type OfficeState,
} from '@vto/shared'
import app from '../src/app.config'
import { config } from '../src/config'
import type { OficinaTallerRoom } from '../src/rooms/OficinaTallerRoom'

/** Espera hasta que `predicate` sea verdadera o venza `timeoutMs`. */
async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout esperando: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return Date.now() - started
}

describe('Sala "Oficina Taller": ciclo conectar / desconectar', () => {
  let colyseus: ColyseusTestServer
  let room: OficinaTallerRoom
  const clients: SdkRoom<OficinaTallerRoom, OfficeState>[] = []

  async function connect(options?: JoinOptions) {
    const client = await colyseus.connectTo(room, options)
    // Las pruebas controlan la desconexión a mano; el reintento automático del
    // SDK confundiría los escenarios de "se cayó y no volvió".
    client.reconnection.enabled = false
    client.onMessage(Message.ROOM_INFO, () => {})
    clients.push(client)
    return client
  }

  /** Salida consentida con tope: un cliente ya cerrado nunca resolvería `leave()`. */
  async function leaveQuietly(client: SdkRoom<OficinaTallerRoom, OfficeState>) {
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

  it('al entrar recibe su sessionId y el estado con su propio jugador', async () => {
    await createRoom()
    const client = await connect()
    await client.waitForInitialState()

    expect(client.sessionId).toBe(room.clients[0].sessionId)
    expect(room.state.players.has(client.sessionId)).toBe(true)
    const me = client.state.players.get(client.sessionId)
    expect(me?.sessionId).toBe(client.sessionId)
    expect(me?.connected).toBe(true)
  })

  it('dos clientes entran a la misma sala y se ven entre sí', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await room.waitForNextPatch()
    await waitFor(
      () => a.state.players.size === 2 && b.state.players.size === 2,
      2_000,
      'ambos ven 2',
    )

    expect(room.state.players.size).toBe(2)
    expect(a.state.players.has(b.sessionId)).toBe(true)
    expect(b.state.players.has(a.sessionId)).toBe(true)
  })

  it('una salida consentida (cerrar pestaña) quita al jugador de inmediato', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a ve 2')

    const code = await b.leave(true)
    expect(code).toBe(CloseCode.CONSENTED)

    const elapsed = await waitFor(() => room.state.players.size === 1, 1_000, 'servidor quita a b')
    await waitFor(() => a.state.players.size === 1, 1_000, 'a ve que b se fue')
    expect(elapsed).toBeLessThan(1_000)
    expect(room.state.players.has(a.sessionId)).toBe(true)
  })

  it('una desconexión sin aviso quita al jugador antes de 3 segundos', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a ve 2')

    const dropped = b.sessionId
    await b.leave(false) // cierra el socket sin avisar: simula red caída

    // Durante la gracia el jugador sigue pero marcado como desconectado.
    await waitFor(() => room.state.players.get(dropped)?.connected === false, 1_000, 'marcado')

    const elapsed = await waitFor(
      () => !room.state.players.has(dropped),
      3_000,
      'servidor lo quita',
    )
    expect(elapsed).toBeLessThan(3_000)
    expect(elapsed).toBeGreaterThanOrEqual(config.reconnectGraceSeconds * 1000 - 200)
    await waitFor(() => a.state.players.size === 1, 1_000, 'a ve que b se fue')
  })

  it('reconectar dentro de la gracia conserva la misma sesión sin duplicados', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => a.state.players.size === 2, 2_000, 'a ve 2')

    const token = b.reconnectionToken
    const sessionId = b.sessionId
    await b.leave(false)
    await waitFor(() => room.state.players.get(sessionId)?.connected === false, 1_000, 'marcado')

    const again = await colyseus.sdk.reconnect<OficinaTallerRoom>(token)
    again.reconnection.enabled = false
    clients.push(again)

    expect(again.sessionId).toBe(sessionId)
    await waitFor(() => room.state.players.get(sessionId)?.connected === true, 1_000, 'reconectado')
    expect(room.state.players.size).toBe(2)
    await waitFor(() => a.state.players.size === 2, 1_000, 'a sigue viendo 2')
  })

  it('refrescar varias veces deja exactamente un jugador por navegador', async () => {
    await createRoom()
    const observer = await connect()

    let current = await connect()
    for (let i = 0; i < 5; i++) {
      await current.leave(true) // el cliente hace leave consentido en pagehide
      current = await connect()
    }

    await waitFor(() => room.state.players.size === 2, 2_000, 'observador + 1 jugador')
    await waitFor(() => observer.state.players.size === 2, 2_000, 'observador ve 2')
    expect(room.state.players.has(current.sessionId)).toBe(true)
  })

  it('el jugador aparece en el punto de aparición definido en el mapa', async () => {
    await createRoom()
    const client = await connect()
    await client.waitForInitialState()

    const me = room.state.players.get(client.sessionId)!
    const { spawn } = room.map
    const distance = Math.hypot(me.x - spawn.x, me.y - spawn.y)
    expect(distance).toBeLessThanOrEqual(spawn.radius + 1)
  })

  it('un mensaje de movimiento actualiza la posición y la acota al mapa', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b ve 2')

    a.send(Message.MOVE, { x: 300, y: 200, dir: 'left', moving: true })
    await waitFor(() => room.state.players.get(a.sessionId)?.x === 300, 1_000, 'servidor mueve')
    await waitFor(() => b.state.players.get(a.sessionId)?.y === 200, 1_000, 'b ve el movimiento')
    expect(b.state.players.get(a.sessionId)?.dir).toBe('left')
    expect(b.state.players.get(a.sessionId)?.moving).toBe(true)

    a.send(Message.MOVE, { x: 300, y: 200, dir: 'diagonal', moving: 'yes' })
    await room.waitForNextPatch().catch(() => {})
    // Dirección inválida: se conserva la anterior; moving solo acepta `true`.
    expect(room.state.players.get(a.sessionId)?.dir).toBe('left')
    expect(room.state.players.get(a.sessionId)?.moving).toBe(false)

    a.send(Message.MOVE, { x: -50, y: 99_999 })
    await waitFor(() => room.state.players.get(a.sessionId)?.x === 0, 1_000, 'acotado en x')
    expect(room.state.players.get(a.sessionId)?.y).toBe(room.map.bounds.height)

    a.send(Message.MOVE, { x: 'nope', y: NaN })
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(a.sessionId)?.x).toBe(0)
  })

  it('entra con el nombre y avatar elegidos, y todos los ven', async () => {
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
      'el observador ve el nombre',
    )
    expect(observer.state.players.get(client.sessionId)?.avatar).toBe('iris')
  })

  it('opciones inválidas caen en nombre de invitado, avatar por defecto y nombre acotado', async () => {
    await createRoom()
    const anon = await connect({ name: '   ', avatar: 'pikachu' })
    const long = await connect({ name: 'x'.repeat(NAME_MAX_LENGTH + 10), avatar: 42 as never })
    await long.waitForInitialState()

    expect(room.state.players.get(anon.sessionId)?.name).toBe(
      `Invitado-${anon.sessionId.slice(0, 4)}`,
    )
    expect(room.state.players.get(anon.sessionId)?.avatar).toBe(DEFAULT_AVATAR)
    expect(room.state.players.get(long.sessionId)?.name).toBe('x'.repeat(NAME_MAX_LENGTH))
    expect(room.state.players.get(long.sessionId)?.avatar).toBe(DEFAULT_AVATAR)
  })

  it('cambiar el nombre se replica; un nombre vacío se ignora', async () => {
    await createRoom()
    const a = await connect({ name: 'Ana' })
    const b = await connect()
    await waitFor(() => b.state.players.get(a.sessionId)?.name === 'Ana', 1_000, 'b ve Ana')

    a.send(Message.SET_NAME, { name: 'Ana María' })
    await waitFor(() => b.state.players.get(a.sessionId)?.name === 'Ana María', 1_000, 'renombrada')

    a.send(Message.SET_NAME, { name: '   ' })
    await room.waitForNextPatch().catch(() => {})
    expect(room.state.players.get(a.sessionId)?.name).toBe('Ana María')
  })

  it('sin actividad pasa a "ausente" y al moverse vuelve a "activo"', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b ve 2')
    expect(room.state.players.get(a.sessionId)?.away).toBe(false)

    // AWAY_AFTER_SECONDS=1 en vitest.config.ts; el chequeo corre cada 1 s.
    const elapsed = await waitFor(
      () => b.state.players.get(a.sessionId)?.away === true,
      3_500,
      'b ve a a ausente',
    )
    expect(elapsed).toBeGreaterThanOrEqual(config.awayAfterSeconds * 1000 - 200)
    expect(room.state.players.get(a.sessionId)?.awayManual).toBe(false)

    a.send(Message.MOVE, { x: 400, y: 300, dir: 'right', moving: true })
    await waitFor(
      () => b.state.players.get(a.sessionId)?.away === false,
      1_000,
      'a vuelve a activo',
    )
  })

  it('el "ausente" manual se fija y se quita a mano, y moverse no lo quita', async () => {
    await createRoom()
    const a = await connect()
    const b = await connect()
    await waitFor(() => b.state.players.size === 2, 2_000, 'b ve 2')

    a.send(Message.SET_AWAY, { away: true })
    await waitFor(() => b.state.players.get(a.sessionId)?.away === true, 1_000, 'b ve ausente')
    expect(b.state.players.get(a.sessionId)?.awayManual).toBe(true)

    a.send(Message.MOVE, { x: 400, y: 300, dir: 'up', moving: true })
    await waitFor(() => b.state.players.get(a.sessionId)?.x === 400, 1_000, 'b ve el movimiento')
    expect(b.state.players.get(a.sessionId)?.away).toBe(true)

    a.send(Message.SET_AWAY, { away: false })
    await waitFor(() => b.state.players.get(a.sessionId)?.away === false, 1_000, 'b ve activo')
    expect(b.state.players.get(a.sessionId)?.awayManual).toBe(false)
  })
})
