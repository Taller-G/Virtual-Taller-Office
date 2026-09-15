import { Client, CloseCode, type Room } from '@colyseus/sdk'
import {
  DEFAULT_WORLD_ID,
  getWorld,
  Message,
  newChatId,
  roomNameFor,
  validateChatText,
  type ChatErrorPayload,
  type ChatMessagePayload,
  type ChatRejection,
  type ChatSendPayload,
  type JoinOptions,
  type OfficeState,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
  type WavePayload,
  type WaveSendPayload,
} from '@vto/shared'
import type { WorldRoom } from '@vto/server/rooms/WorldRoom'

export type OfficeRoom = Room<WorldRoom, OfficeState>

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface ConnectionEvents {
  /** The connection status changed. `detail` is a short text for the UI. */
  status: (status: ConnectionStatus, detail?: string) => void
  /**
   * There is a new room (initial join or rejoin after losing the server).
   * Listeners must discard what they had and hook their callbacks up again.
   */
  room: (room: OfficeRoom) => void
  /** Metadata the server sends on joining (sessionId included). */
  roomInfo: (info: RoomInfoPayload) => void
  /**
   * A message from the bubble arrived. The server already filtered the
   * recipients, so everything that reaches here is from my conversation; it
   * includes the echo of my own messages, which acts as the acknowledgement.
   */
  chat: (message: ChatMessagePayload) => void
  /** The server did not accept one of my messages (`id` to recognise it). */
  chatError: (error: ChatErrorPayload) => void
  /** Somebody waved at me. */
  wave: (wave: WavePayload) => void
  /** I changed world: the room in `room` is already the new world's. */
  world: (worldId: string) => void
}

type Listener<E extends keyof ConnectionEvents> = ConnectionEvents[E]

/** Cap of the backoff between rejoin attempts, in ms. */
const MAX_REJOIN_DELAY_MS = 10_000
/** How long the destination world is waited for before giving the trip up for lost. */
const TRAVEL_TIMEOUT_MS = 8_000

/**
 * Connection with the room of the world I am in.
 *
 * There is one room per world (`world_first_office`, `world_chiron_office`...)
 * and this class holds the current world's. **Travelling** through a door is
 * joining the destination's room first and only then leaving the origin's: if
 * the destination is unavailable, the place you were in is not lost.
 *
 * Two layers of recovery:
 * 1. The SDK retries on its own after a drop (network down) keeping the
 *    session, if the server still holds the seat -> `onDrop` / `onReconnect`.
 * 2. If that fails (the server restarted and the room no longer exists, or the
 *    server is down), this class calls `joinOrCreate` again with exponential
 *    backoff until it succeeds. A new session is obtained.
 *
 * On closing or refreshing the tab a consented `leave` is issued so the server
 * removes the player instantly and no ghost avatar is left behind.
 */
export class OfficeConnection {
  readonly client: Client
  room?: OfficeRoom
  status: ConnectionStatus = 'disconnected'
  /** World I am in (id from the `@vto/shared` registry). */
  worldId: string = DEFAULT_WORLD_ID

  private listeners: { [E in keyof ConnectionEvents]: Set<Listener<E>> } = {
    status: new Set(),
    room: new Set(),
    roomInfo: new Set(),
    chat: new Set(),
    chatError: new Set(),
    wave: new Set(),
    world: new Set(),
  }
  private rejoinAttempts = 0
  private rejoinTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  /** While a trip is under way no other one is accepted and rejoining is not retried. */
  private traveling = false
  /** Name and avatar to join with (and to rejoin with after a drop). */
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

  /** Joins the room with the chosen identity and arms the automatic recovery. */
  async start(options: JoinOptions) {
    this.joinOptions = options
    this.stopped = false
    this.setStatus('connecting')
    await this.join()
  }

  /** Changes my visible name. The server validates it and replicates it to everyone. */
  setName(name: string) {
    this.joinOptions = { ...this.joinOptions, name }
    const payload: SetNamePayload = { name }
    this.room?.send(Message.SET_NAME, payload)
  }

  /**
   * Sends a message to my bubble. It validates the text before spending
   * network (the same validator the server uses) and returns the `id` the
   * sender will recognise the echo or the error by, plus the already
   * normalised text exactly as everyone else will see it. Who receives it is
   * the server's decision.
   */
  sendChat(
    text: string,
  ): { ok: true; id: string; text: string } | { ok: false; reason: ChatRejection } {
    const valid = validateChatText(text)
    if (!valid.ok) return { ok: false, reason: valid.reason }
    if (!this.room) return { ok: false, reason: 'offline' }
    const id = newChatId()
    const payload: ChatSendPayload = { id, text: valid.text }
    this.room.send(Message.CHAT_SEND, payload)
    return { ok: true, id, text: valid.text }
  }

  /**
   * Waves at somebody. Fire and forget: the server answers a wave it will not
   * relay with silence, so the cooldown below is what the button leans on -
   * the server holds the same one as the authority.
   */
  sendWave(to: string): boolean {
    if (!this.room || !to || to === this.room.sessionId) return false
    const payload: WaveSendPayload = { to }
    this.room.send(Message.WAVE_SEND, payload)
    return true
  }

  /** Sets or clears my "away" state by hand. */
  setAway(away: boolean) {
    const payload: SetAwayPayload = { away }
    this.room?.send(Message.SET_AWAY, payload)
  }

  /**
   * Consented leave. It is called on `pagehide`: the server gets the notice
   * before the browser closes the socket.
   */
  leaveForGood() {
    this.stopped = true
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer)
    this.room?.leave(true).catch(() => {})
  }

  /**
   * Crossing a door: joining the world `worldId` through the spawn `spawn`.
   *
   * The destination is joined first and only once that is settled is the
   * origin left, so a world that is down, full or with a broken map leaves the
   * player where they were (with the reason to show) instead of in limbo.
   * Name, avatar and presence state travel with the player.
   */
  async travelTo(
    worldId: string,
    spawn: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const world = getWorld(worldId)
    if (!world) return { ok: false, reason: `The world "${worldId}" does not exist` }
    if (this.traveling) return { ok: false, reason: 'You are already crossing a door' }
    if (worldId === this.worldId) return { ok: false, reason: `You are already in ${world.name}` }

    this.traveling = true
    const origin = this.room
    const me = origin?.state.players.get(origin.sessionId)
    const options: JoinOptions = {
      ...this.joinOptions,
      spawn,
      away: me?.away ?? false,
      awayManual: me?.awayManual ?? false,
    }

    try {
      // `join` (and not `joinOrCreate`): if that world's room is not alive,
      // the trip fails instead of bringing a world up behind the server's
      // back.
      const room = await this.joinWithTimeout(roomNameFor(worldId), options)
      await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()))

      if (origin) {
        // The origin is left on purpose: its `onLeave` must not fire the
        // automatic rejoin (see the guard in `attach`).
        this.room = undefined
        void origin.leave(true).catch(() => {})
      }
      this.worldId = worldId
      this.attach(room)
      this.emit('world', worldId)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: `Could not join ${world.name}: ${detail(error)}` }
    } finally {
      this.traveling = false
    }
  }

  /**
   * `join` with a time cap. If the server answers late, the room that arrives
   * is left instantly: nobody is left as a ghost at the destination.
   */
  private async joinWithTimeout(roomName: string, options: JoinOptions): Promise<OfficeRoom> {
    const joining = this.client.join<WorldRoom>(roomName, options)
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void joining.then((room) => room.leave(true)).catch(() => {})
        reject(new Error('the world did not answer in time'))
      }, TRAVEL_TIMEOUT_MS)
    })
    try {
      return await Promise.race([joining, timeout])
    } finally {
      clearTimeout(timer!)
    }
  }

  private async join() {
    if (this.stopped) return
    try {
      const room = await this.client.joinOrCreate<WorldRoom>(
        roomNameFor(this.worldId),
        this.joinOptions,
      )
      // `joinOrCreate` resolves once the handshake completes; the initial
      // state arrives in the next message. It is awaited so that whoever
      // listens to `room` already finds every player (oneself included).
      await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()))
      this.attach(room)
    } catch (error) {
      this.scheduleRejoin(describe(error))
    }
  }

  private attach(room: OfficeRoom) {
    this.room = room
    this.rejoinAttempts = 0

    // The SDK's retries are capped: if the room no longer exists it is better
    // to fail soon and move on to the rejoin (layer 2) instead of insisting
    // for a minute.
    room.reconnection.maxRetries = 5
    room.reconnection.maxDelay = 2_000

    room.onMessage(Message.ROOM_INFO, (info) => this.emit('roomInfo', info))
    room.onMessage(Message.CHAT_MESSAGE, (message) => this.emit('chat', message))
    room.onMessage(Message.CHAT_ERROR, (error) => this.emit('chatError', error))
    room.onMessage(Message.WAVE, (wave) => this.emit('wave', wave))

    room.onDrop((code, reason) => {
      if (this.room !== room) return
      this.setStatus('reconnecting', reason || `code ${code}`)
    })

    room.onReconnect(() => {
      if (this.room !== room) return
      this.setStatus('connected')
    })

    room.onError((code, message) => {
      console.warn(`[connection] error ${code}: ${message ?? ''}`)
    })

    room.onLeave((code, reason) => {
      // An old room left behind when crossing a door: another one is already up.
      if (this.room !== room) return
      this.room = undefined
      if (this.stopped || code === CloseCode.CONSENTED) {
        this.setStatus('disconnected', 'You left the room')
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
    this.setStatus('disconnected', `${reason}. Retrying in ${Math.round(delay / 1000)} s...`)
    console.info(`[connection] ${reason}; retry #${this.rejoinAttempts} in ${delay} ms`)
    this.rejoinTimer = setTimeout(() => void this.join(), delay)
  }
}

function reasonFor(code: number, reason?: string): string {
  switch (code) {
    case CloseCode.SERVER_SHUTDOWN:
      return 'The server shut down'
    case CloseCode.FAILED_TO_RECONNECT:
      return 'Could not reconnect'
    default:
      return reason || `Connection closed (code ${code})`
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return `Could not connect: ${error.message}`
  return 'Could not connect to the server'
}

/** The reason as it is, to compose it into a message of our own. */
function detail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'the server did not answer'
}
