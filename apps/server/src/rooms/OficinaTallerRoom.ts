import { Room, type Client, CloseCode } from 'colyseus'
import {
  clamp,
  Message,
  OfficeState,
  Player,
  randomSpawnPosition,
  ROOM_DISPLAY_NAME,
  type MovePayload,
  type RoomInfoPayload,
} from '@vto/shared'
import { config } from '../config'
import { DEFAULT_MAP_FILE, loadOfficeMap, type OfficeMap } from '../map'

/**
 * Sala única y persistente "Oficina Taller".
 *
 * Reglas de conexión:
 * - `onJoin`: se agrega un `Player` al estado bajo `client.sessionId`.
 * - `onDrop` (cierre NO consentido: red caída, pestaña colgada): se marca al
 *   jugador como desconectado y se sostiene su asiento `reconnectGraceSeconds`.
 *   Si reconecta a tiempo conserva la sesión; si no, cae en `onLeave`.
 * - `onLeave` (cierre consentido o gracia vencida): se quita al jugador y el
 *   patch de estado avisa al resto.
 *
 * El cliente hace un `leave` consentido al cerrar/refrescar la pestaña, así
 * la baja es inmediata y refrescar nunca deja un avatar duplicado.
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

  async onCreate() {
    this.map = loadOfficeMap(config.mapFile ?? DEFAULT_MAP_FILE)
    console.log(
      `[sala] mapa ${this.map.file} (${this.map.bounds.width}x${this.map.bounds.height} px, spawn ${this.map.spawn.x},${this.map.spawn.y})`,
    )

    this.onMessage(Message.MOVE, (client, payload: MovePayload) => this.onMove(client, payload))

    await this.setMetadata({ name: ROOM_DISPLAY_NAME })
    console.log(`[sala] "${ROOM_DISPLAY_NAME}" creada (roomId=${this.roomId})`)
  }

  onJoin(client: Client) {
    const { x, y } = randomSpawnPosition(this.map.spawn, this.map.bounds)
    const player = new Player({
      sessionId: client.sessionId,
      name: `Invitado-${client.sessionId.slice(0, 4)}`,
      x,
      y,
      connected: true,
    })
    this.state.players.set(client.sessionId, player)

    const info: RoomInfoPayload = {
      roomId: this.roomId,
      name: ROOM_DISPLAY_NAME,
      sessionId: client.sessionId,
    }
    client.send(Message.ROOM_INFO, info)
    console.log(`[sala] entra ${client.sessionId} (${this.state.players.size} en sala)`)
  }

  /**
   * El cliente manda su posición ya resuelta contra las colisiones del mapa;
   * el servidor la acota a los límites y la replica. (Validar colisiones del
   * lado del servidor queda para más adelante.)
   */
  private onMove(client: Client, payload: MovePayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const x = Number(payload?.x)
    const y = Number(payload?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    player.x = clamp(Math.round(x), 0, this.map.bounds.width)
    player.y = clamp(Math.round(y), 0, this.map.bounds.height)
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
    this.state.players.delete(client.sessionId)
    const reason = code === CloseCode.CONSENTED ? 'salida consentida' : `code=${code}`
    console.log(`[sala] sale ${client.sessionId} (${reason}; ${this.state.players.size} en sala)`)
  }

  onDispose() {
    console.log(`[sala] "${ROOM_DISPLAY_NAME}" cerrada (roomId=${this.roomId})`)
  }
}
