import { Room, type Client, CloseCode } from 'colyseus'
import {
  clamp,
  findSpawnPoint,
  getWorld,
  guestName,
  isDirection,
  MapError,
  Message,
  OfficeState,
  Player,
  randomSpawnPosition,
  sanitizeAppearance,
  sanitizeAvatar,
  sanitizeName,
  worldForRoomName,
  type ChatSendPayload,
  type JoinOptions,
  type MovePayload,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
  type SpawnPoint,
  type WorldDefinition,
} from '@vto/shared'
import { BubbleManager } from '../bubbles'
import { ChatRelay } from '../chat'
import { config, DEFAULT_BUBBLE_RADIUS_TILES } from '../config'
import { worldMap, type WorldMap } from '../map'

/** Lo que `defineRoom` le pasa a la sala de cada mundo (ver `app.config.ts`). */
export interface WorldRoomOptions {
  worldId?: string
}

/** Cada cuánto se revisa quién lleva demasiado tiempo sin actividad. */
const AWAY_CHECK_INTERVAL_MS = 1_000

/**
 * Sala persistente de **un mundo**: la First Office, la Chiron Office o
 * cualquier otro del registro de `@vto/shared`. El servidor registra una sala
 * por mundo (ver `app.config.ts`), así que cada mundo tiene su mapa, su gente,
 * sus burbujas y su chat sin compartir nada con los demás.
 *
 * Reglas de conexión:
 * - `onJoin`: se agrega un `Player` al estado bajo `client.sessionId`, con el
 *   nombre y avatar que eligió el usuario (validados; con fallback).
 * - `onDrop` (cierre NO consentido: red caída, pestaña colgada): se marca al
 *   jugador como desconectado y se sostiene su asiento `reconnectGraceSeconds`.
 *   Si reconecta a tiempo conserva la sesión; si no, cae en `onLeave`.
 * - `onLeave` (cierre consentido o gracia vencida): se quita al jugador y el
 *   patch de estado avisa al resto.
 *
 * Presencia:
 * - Cada `MOVE` (o cambio de nombre) cuenta como actividad. Un jugador sin
 *   actividad durante `awayAfterSeconds` pasa a `away = true`; al volver a
 *   moverse vuelve a activo.
 * - `SET_AWAY` fija el ausente a mano (`awayManual`): moverse no lo quita,
 *   solo otro `SET_AWAY { away: false }`.
 *
 * Burbujas de conversación (ver `bubbles.ts`): tras cada `MOVE` acotado y en
 * cada salida se recalcula la pertenencia. El cliente no tiene mensaje para
 * pedir ni forzar una burbuja: solo refleja `state.bubbles` y `player.bubbleId`.
 *
 * Chat de la burbuja (ver `chat.ts`): `CHAT_SEND` se retransmite únicamente a
 * los miembros que la burbuja del remitente tiene en ese momento (el remitente
 * incluido, como acuse). Los mensajes son efímeros: no entran al estado ni se
 * guardan en ningún lado, así que quien llega después no ve nada de antes.
 *
 * El servidor es la fuente de verdad de la lista de jugadores y de las
 * burbujas: el cliente solo refleja `state.players` y `state.bubbles`.
 *
 * Mapa: al crearse, la sala toma el mapa de su mundo (el mismo archivo Tiled
 * que dibuja el cliente) y de ahí los puntos de aparición y los límites. Los
 * mapas de todos los mundos se leen y validan juntos al arrancar —puertas
 * incluidas—: si alguno no es válido, el servidor no arranca.
 *
 * Puertas: viajar es salir de esta sala y entrar a la del mundo destino. La
 * sala destino recibe en `options.spawn` el nombre del punto de llegada que
 * nombra la puerta, y en `options.away` el estado de presencia del que viaja.
 */
export class WorldRoom extends Room<{ state: OfficeState }> {
  /** La sala vive aunque no haya nadie: todos los de ese mundo entran a la misma. */
  autoDispose = false
  maxClients = config.maxClients
  state = new OfficeState()
  /** El mundo que hospeda esta sala. */
  world!: WorldDefinition
  map!: WorldMap
  bubbles!: BubbleManager
  chat!: ChatRelay
  /** Último instante (ms, reloj de la sala) con actividad por sessionId. */
  private lastActivity = new Map<string, number>()

  async onCreate(options?: WorldRoomOptions) {
    // El mundo sale del nombre con el que se registró la sala; las opciones
    // de `defineRoom` son el respaldo (y lo que usan las pruebas).
    const world = worldForRoomName(this.roomName) ?? getWorld(options?.worldId ?? '')
    if (!world) {
      throw new MapError(
        `La sala "${this.roomName}" no corresponde a ningún mundo configurado (ver WORLDS en @vto/shared)`,
      )
    }
    this.world = world
    this.map = worldMap(world.id)
    console.log(
      `[mundo ${world.id}] mapa ${this.map.file} (${this.map.bounds.width}x${this.map.bounds.height} px, entrada ${this.map.spawn.x},${this.map.spawn.y})`,
    )

    this.bubbles = new BubbleManager(this.state, {
      radius: config.bubbleRadiusPx ?? DEFAULT_BUBBLE_RADIUS_TILES * this.map.data.tilewidth,
      maxMembers: config.bubbleMaxMembers,
    })
    console.log(
      `[mundo ${world.id}] burbujas: radio ${this.bubbles.radius} px, tope ${this.bubbles.maxMembers} miembros`,
    )

    this.chat = new ChatRelay(this.state, {
      maxPerWindow: config.chatMaxPerWindow,
      windowMs: config.chatRateWindowMs,
    })

    this.onMessage(Message.MOVE, (client, payload: MovePayload) => this.onMove(client, payload))
    this.onMessage(Message.SET_NAME, (client, payload: SetNamePayload) =>
      this.onSetName(client, payload),
    )
    this.onMessage(Message.SET_AWAY, (client, payload: SetAwayPayload) =>
      this.onSetAway(client, payload),
    )
    this.onMessage(Message.CHAT_SEND, (client, payload: ChatSendPayload) =>
      this.onChatSend(client, payload),
    )

    this.clock.setInterval(() => this.checkAway(), AWAY_CHECK_INTERVAL_MS)

    await this.setMetadata({ name: world.name, worldId: world.id })
    console.log(`[mundo ${world.id}] "${world.name}" listo (roomId=${this.roomId})`)
  }

  onJoin(client: Client, options?: JoinOptions) {
    // Quien llega por una puerta lo hace en el spawn que esa puerta nombra, y
    // mirando hacia donde ese spawn diga: de espaldas a la puerta de vuelta.
    const spawn = this.spawnFor(options?.spawn)
    const { x, y } = randomSpawnPosition(spawn, this.map.bounds)
    const away = options?.away === true
    const player = new Player({
      sessionId: client.sessionId,
      name: sanitizeName(options?.name) ?? guestName(client.sessionId),
      avatar: sanitizeAvatar(options?.avatar),
      appearance: sanitizeAppearance(options?.appearance),
      x,
      y,
      dir: spawn.dir,
      moving: false,
      // Viajar no cambia el estado de presencia: se llega como se salió.
      away,
      awayManual: away && options?.awayManual === true,
      connected: true,
    })
    this.state.players.set(client.sessionId, player)
    this.touch(client.sessionId)
    // Aparecer al lado de alguien también cuenta como estar cerca.
    this.bubbles.onPlayerMoved(player)

    const info: RoomInfoPayload = {
      roomId: this.roomId,
      worldId: this.world.id,
      name: this.world.name,
      sessionId: client.sessionId,
    }
    client.send(Message.ROOM_INFO, info)
    console.log(
      `[mundo ${this.world.id}] entra ${client.sessionId} como "${player.name}" (${player.avatar}; spawn "${spawn.name}"; ${this.state.players.size} presentes)`,
    )
  }

  /**
   * El spawn por el que entra alguien: el que nombra la puerta que cruzó o,
   * si no nombra ninguno (o nombra uno que este mapa no tiene), la entrada del
   * mundo. La validación cruzada al arrancar ya garantiza que las puertas
   * reales apunten a spawns que existen; esto cubre a un cliente inventivo.
   */
  private spawnFor(name?: string): SpawnPoint {
    const wanted = typeof name === 'string' ? name.trim() : ''
    if (wanted === '') return this.map.spawn
    try {
      return findSpawnPoint(this.map.data, wanted)
    } catch {
      console.warn(`[mundo ${this.world.id}] spawn "${wanted}" desconocido; se usa la entrada`)
      return this.map.spawn
    }
  }

  /**
   * El cliente manda su posición ya resuelta contra las colisiones del mapa;
   * el servidor la acota a los límites y la replica junto con la animación.
   * (Validar colisiones del lado del servidor queda para más adelante.)
   */
  private onMove(client: Client, payload: MovePayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const x = Number(payload?.x)
    const y = Number(payload?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    player.x = clamp(Math.round(x), 0, this.map.bounds.width)
    player.y = clamp(Math.round(y), 0, this.map.bounds.height)
    if (isDirection(payload.dir)) player.dir = payload.dir
    player.moving = payload.moving === true
    this.markActive(player)
    // La pertenencia a burbujas se decide acá, con la posición ya acotada.
    this.bubbles.onPlayerMoved(player)
  }

  private onSetName(client: Client, payload: SetNamePayload) {
    const player = this.state.players.get(client.sessionId)
    const name = sanitizeName(payload?.name)
    if (!player || !name) return
    player.name = name
    this.markActive(player)
  }

  private onSetAway(client: Client, payload: SetAwayPayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    if (payload?.away === true) {
      player.away = true
      player.awayManual = true
    } else {
      player.away = false
      player.awayManual = false
      this.touch(client.sessionId)
    }
  }

  /**
   * Mensaje de chat: lo resuelve `ChatRelay` (valida, exige burbuja y acota el
   * ritmo) y el servidor lo manda solo a los clientes de esa burbuja. Si no se
   * acepta, el motivo vuelve únicamente al remitente. Nada se guarda.
   */
  private onChatSend(client: Client, payload: ChatSendPayload) {
    const outcome = this.chat.submit(client.sessionId, payload, Date.now())
    if (!outcome.ok) {
      client.send(Message.CHAT_ERROR, outcome.error)
      return
    }
    for (const sessionId of outcome.recipients) {
      this.clients.getById(sessionId)?.send(Message.CHAT_MESSAGE, outcome.message)
    }
    // Escribir también es actividad: no te marca ausente mientras conversás.
    const player = this.state.players.get(client.sessionId)
    if (player) this.markActive(player)
  }

  /** Registra actividad; el ausente automático se levanta, el manual no. */
  private markActive(player: Player) {
    this.touch(player.sessionId)
    if (player.away && !player.awayManual) player.away = false
  }

  private touch(sessionId: string) {
    this.lastActivity.set(sessionId, this.clock.currentTime)
  }

  private checkAway() {
    const limit = config.awayAfterSeconds * 1000
    const now = this.clock.currentTime
    this.state.players.forEach((player, sessionId) => {
      if (player.away) return
      const last = this.lastActivity.get(sessionId) ?? now
      if (now - last >= limit) player.away = true
    })
  }

  onDrop(client: Client, code?: number) {
    // Si el servidor se está apagando no tiene sentido sostener el asiento:
    // sin allowReconnection el framework pasa directo a onLeave().
    if (code === CloseCode.SERVER_SHUTDOWN) return

    const player = this.state.players.get(client.sessionId)
    if (player) player.connected = false
    console.log(
      `[mundo ${this.world.id}] se cortó ${client.sessionId} (code=${code}); se sostiene el asiento ${config.reconnectGraceSeconds}s`,
    )
    // No se espera el resultado: el framework enruta a onReconnect() u onLeave().
    // El catch evita un "unhandled rejection" cuando la sala se está cerrando.
    this.allowReconnection(client, config.reconnectGraceSeconds).catch(() => {})
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId)
    if (player) player.connected = true
    console.log(`[mundo ${this.world.id}] reconectó ${client.sessionId}`)
  }

  onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId)
    // Primero se lo quita del estado y después se recalculan las burbujas: así
    // los que queden libres no vuelven a agruparse con quien ya se fue.
    this.state.players.delete(client.sessionId)
    if (player) this.bubbles.onPlayerLeft(player)
    this.lastActivity.delete(client.sessionId)
    this.chat.forget(client.sessionId)
    const reason = code === CloseCode.CONSENTED ? 'salida consentida' : `code=${code}`
    console.log(
      `[mundo ${this.world.id}] sale ${client.sessionId} (${reason}; ${this.state.players.size} presentes)`,
    )
  }

  onDispose() {
    console.log(`[mundo ${this.world.id}] "${this.world.name}" cerrado (roomId=${this.roomId})`)
  }
}
