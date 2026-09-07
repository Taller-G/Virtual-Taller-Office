import { Room, type Client, CloseCode } from 'colyseus'
import {
  clamp,
  guestName,
  isDirection,
  Message,
  OfficeState,
  Player,
  randomSpawnPosition,
  ROOM_DISPLAY_NAME,
  sanitizeAvatar,
  sanitizeName,
  type JoinOptions,
  type MovePayload,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
} from '@vto/shared'
import { BubbleManager } from '../bubbles'
import { config, DEFAULT_BUBBLE_RADIUS_TILES } from '../config'
import { DEFAULT_MAP_FILE, loadOfficeMap, type OfficeMap } from '../map'

/** Cada cuánto se revisa quién lleva demasiado tiempo sin actividad. */
const AWAY_CHECK_INTERVAL_MS = 1_000

/**
 * Sala única y persistente "Oficina Taller".
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
 * El servidor es la fuente de verdad de la lista de jugadores y de las
 * burbujas: el cliente solo refleja `state.players` y `state.bubbles`.
 *
 * Mapa: al crearse, la sala lee el mismo archivo Tiled que dibuja el cliente
 * (`MAP_FILE`) y toma de ahí el punto de aparición y los límites. Si el mapa
 * no es válido la sala no se crea y el servidor no arranca.
 */
export class OficinaTallerRoom extends Room<{ state: OfficeState }> {
  /** La sala vive aunque no haya nadie: todos entran siempre a la misma. */
  autoDispose = false
  maxClients = config.maxClients
  state = new OfficeState()
  map!: OfficeMap
  bubbles!: BubbleManager
  /** Último instante (ms, reloj de la sala) con actividad por sessionId. */
  private lastActivity = new Map<string, number>()

  async onCreate() {
    this.map = loadOfficeMap(config.mapFile ?? DEFAULT_MAP_FILE)
    console.log(
      `[sala] mapa ${this.map.file} (${this.map.bounds.width}x${this.map.bounds.height} px, spawn ${this.map.spawn.x},${this.map.spawn.y})`,
    )

    this.bubbles = new BubbleManager(this.state, {
      radius: config.bubbleRadiusPx ?? DEFAULT_BUBBLE_RADIUS_TILES * this.map.data.tilewidth,
      maxMembers: config.bubbleMaxMembers,
    })
    console.log(
      `[sala] burbujas: radio ${this.bubbles.radius} px, tope ${this.bubbles.maxMembers} miembros`,
    )

    this.onMessage(Message.MOVE, (client, payload: MovePayload) => this.onMove(client, payload))
    this.onMessage(Message.SET_NAME, (client, payload: SetNamePayload) =>
      this.onSetName(client, payload),
    )
    this.onMessage(Message.SET_AWAY, (client, payload: SetAwayPayload) =>
      this.onSetAway(client, payload),
    )

    this.clock.setInterval(() => this.checkAway(), AWAY_CHECK_INTERVAL_MS)

    await this.setMetadata({ name: ROOM_DISPLAY_NAME })
    console.log(`[sala] "${ROOM_DISPLAY_NAME}" creada (roomId=${this.roomId})`)
  }

  onJoin(client: Client, options?: JoinOptions) {
    const { x, y } = randomSpawnPosition(this.map.spawn, this.map.bounds)
    const player = new Player({
      sessionId: client.sessionId,
      name: sanitizeName(options?.name) ?? guestName(client.sessionId),
      avatar: sanitizeAvatar(options?.avatar),
      x,
      y,
      dir: 'down',
      moving: false,
      away: false,
      awayManual: false,
      connected: true,
    })
    this.state.players.set(client.sessionId, player)
    this.touch(client.sessionId)
    // Aparecer al lado de alguien también cuenta como estar cerca.
    this.bubbles.onPlayerMoved(player)

    const info: RoomInfoPayload = {
      roomId: this.roomId,
      name: ROOM_DISPLAY_NAME,
      sessionId: client.sessionId,
    }
    client.send(Message.ROOM_INFO, info)
    console.log(
      `[sala] entra ${client.sessionId} como "${player.name}" (${player.avatar}; ${this.state.players.size} en sala)`,
    )
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
      `[sala] se cortó ${client.sessionId} (code=${code}); se sostiene el asiento ${config.reconnectGraceSeconds}s`,
    )
    // No se espera el resultado: el framework enruta a onReconnect() u onLeave().
    // El catch evita un "unhandled rejection" cuando la sala se está cerrando.
    this.allowReconnection(client, config.reconnectGraceSeconds).catch(() => {})
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId)
    if (player) player.connected = true
    console.log(`[sala] reconectó ${client.sessionId}`)
  }

  onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId)
    // Primero se lo quita del estado y después se recalculan las burbujas: así
    // los que queden libres no vuelven a agruparse con quien ya se fue.
    this.state.players.delete(client.sessionId)
    if (player) this.bubbles.onPlayerLeft(player)
    this.lastActivity.delete(client.sessionId)
    const reason = code === CloseCode.CONSENTED ? 'salida consentida' : `code=${code}`
    console.log(`[sala] sale ${client.sessionId} (${reason}; ${this.state.players.size} en sala)`)
  }

  onDispose() {
    console.log(`[sala] "${ROOM_DISPLAY_NAME}" cerrada (roomId=${this.roomId})`)
  }
}
