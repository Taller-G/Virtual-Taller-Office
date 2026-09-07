import { Client, CloseCode, type Room } from '@colyseus/sdk'
import {
  Message,
  ROOM_NAME,
  type JoinOptions,
  type OfficeState,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
} from '@vto/shared'
import type { OficinaTallerRoom } from '@vto/server/rooms/OficinaTallerRoom'

export type OfficeRoom = Room<OficinaTallerRoom, OfficeState>

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface ConnectionEvents {
  /** Cambió el estado de la conexión. `detail` es un texto corto para la UI. */
  status: (status: ConnectionStatus, detail?: string) => void
  /**
   * Hay una sala nueva (entrada inicial o reingreso tras perder al servidor).
   * Quien escucha debe descartar lo que tenía y volver a enganchar callbacks.
   */
  room: (room: OfficeRoom) => void
  /** Metadatos que el servidor envía al entrar (sessionId incluido). */
  roomInfo: (info: RoomInfoPayload) => void
}

type Listener<E extends keyof ConnectionEvents> = ConnectionEvents[E]

/** Tope del backoff entre reintentos de reingreso, en ms. */
const MAX_REJOIN_DELAY_MS = 10_000

/**
 * Conexión con la sala única "Oficina Taller".
 *
 * Dos capas de recuperación:
 * 1. El SDK reintenta solo ante un corte (red caída) conservando la sesión,
 *    si el servidor todavía sostiene el asiento → `onDrop` / `onReconnect`.
 * 2. Si eso falla (el servidor se reinició y la sala ya no existe, o el
 *    servidor está caído), esta clase vuelve a hacer `joinOrCreate` con
 *    backoff exponencial hasta lograrlo. Se obtiene una sesión nueva.
 *
 * Al cerrar o refrescar la pestaña se hace un `leave` consentido para que el
 * servidor quite al jugador al instante y no quede un avatar fantasma.
 */
export class OfficeConnection {
  readonly client: Client
  room?: OfficeRoom
  status: ConnectionStatus = 'disconnected'

  private listeners: { [E in keyof ConnectionEvents]: Set<Listener<E>> } = {
    status: new Set(),
    room: new Set(),
    roomInfo: new Set(),
  }
  private rejoinAttempts = 0
  private rejoinTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  /** Nombre y avatar con los que se entra (y se reingresa tras una caída). */
  private joinOptions: JoinOptions = {}

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl)
  }

  on<E extends keyof ConnectionEvents>(event: E, listener: Listener<E>): () => void {
    this.listeners[event].add(listener)
    return () => this.listeners[event].delete(listener)
  }

  private emit<E extends keyof ConnectionEvents>(event: E, ...args: Parameters<Listener<E>>) {
    for (const listener of this.listeners[event]) {
      ;(listener as (...a: Parameters<Listener<E>>) => void)(...args)
    }
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this.status = status
    this.emit('status', status, detail)
  }

  /** Entra a la sala con la identidad elegida y deja armada la recuperación automática. */
  async start(options: JoinOptions) {
    this.joinOptions = options
    this.stopped = false
    this.setStatus('connecting')
    await this.join()
  }

  /** Cambia mi nombre visible. El servidor lo valida y lo replica a todos. */
  setName(name: string) {
    this.joinOptions = { ...this.joinOptions, name }
    const payload: SetNamePayload = { name }
    this.room?.send(Message.SET_NAME, payload)
  }

  /** Fija o quita a mano mi estado "ausente". */
  setAway(away: boolean) {
    const payload: SetAwayPayload = { away }
    this.room?.send(Message.SET_AWAY, payload)
  }

  /**
   * Salida consentida. Se llama en `pagehide`: el servidor recibe el aviso
   * antes de que el navegador cierre el socket.
   */
  leaveForGood() {
    this.stopped = true
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer)
    this.room?.leave(true).catch(() => {})
  }

  private async join() {
    if (this.stopped) return
    try {
      const room = await this.client.joinOrCreate<OficinaTallerRoom>(ROOM_NAME, this.joinOptions)
      // `joinOrCreate` resuelve al completar el handshake; el estado inicial
      // llega en el mensaje siguiente. Se espera para que quien escuche
      // `room` encuentre ya a todos los jugadores (incluido uno mismo).
      await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()))
      this.attach(room)
    } catch (error) {
      this.scheduleRejoin(describe(error))
    }
  }

  private attach(room: OfficeRoom) {
    this.room = room
    this.rejoinAttempts = 0

    // Reintentos del SDK acotados: si la sala ya no existe conviene fallar
    // pronto y pasar al reingreso (capa 2) en vez de insistir un minuto.
    room.reconnection.maxRetries = 5
    room.reconnection.maxDelay = 2_000

    room.onMessage(Message.ROOM_INFO, (info) => this.emit('roomInfo', info))

    room.onDrop((code, reason) => {
      this.setStatus('reconnecting', reason || `código ${code}`)
    })

    room.onReconnect(() => {
      this.setStatus('connected')
    })

    room.onError((code, message) => {
      console.warn(`[conexión] error ${code}: ${message ?? ''}`)
    })

    room.onLeave((code, reason) => {
      this.room = undefined
      if (this.stopped || code === CloseCode.CONSENTED) {
        this.setStatus('disconnected', 'Saliste de la sala')
        return
      }
      this.scheduleRejoin(reasonFor(code, reason))
    })

    this.emit('room', room)
    this.setStatus('connected')
  }

  private scheduleRejoin(reason: string) {
    if (this.stopped) return
    const delay = Math.min(MAX_REJOIN_DELAY_MS, 1_000 * 2 ** this.rejoinAttempts)
    this.rejoinAttempts++
    this.setStatus('disconnected', `${reason}. Reintentando en ${Math.round(delay / 1000)} s…`)
    console.info(`[conexión] ${reason}; reintento #${this.rejoinAttempts} en ${delay} ms`)
    this.rejoinTimer = setTimeout(() => void this.join(), delay)
  }
}

function reasonFor(code: number, reason?: string): string {
  switch (code) {
    case CloseCode.SERVER_SHUTDOWN:
      return 'El servidor se apagó'
    case CloseCode.FAILED_TO_RECONNECT:
      return 'No se pudo reconectar'
    default:
      return reason || `Conexión cerrada (código ${code})`
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return `No se pudo conectar: ${error.message}`
  return 'No se pudo conectar al servidor'
}
