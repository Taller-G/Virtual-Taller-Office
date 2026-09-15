import { Room, type Client, CloseCode } from 'colyseus'
import {
  clamp,
  findSpawnPoint,
  getWorld,
  guestName,
  isAtSeat,
  isDirection,
  isFocused,
  MapError,
  Message,
  OfficeState,
  Player,
  randomSpawnPosition,
  sanitizeAgentCount,
  sanitizeAppearance,
  sanitizeAvatar,
  sanitizeName,
  seatAnchor,
  seatByName,
  worldForRoomName,
  type ChatSendPayload,
  type JoinOptions,
  type MovePayload,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
  type SitPayload,
  type SpawnPoint,
  type WorldDefinition,
} from '@vto/shared'
import { BubbleManager } from '../bubbles'
import { ChatRelay } from '../chat'
import { config, DEFAULT_BUBBLE_RADIUS_TILES } from '../config'
import { worldMap, type WorldMap } from '../map'

/** What `defineRoom` passes to each world's room (see `app.config.ts`). */
export interface WorldRoomOptions {
  worldId?: string
}

/** How often it is checked who has gone too long without activity. */
const AWAY_CHECK_INTERVAL_MS = 1_000

/**
 * Persistent room of **one world**: the First Office, the Chiron Office or any
 * other one in the `@vto/shared` registry. The server registers one room per
 * world (see `app.config.ts`), so each world has its map, its people, its
 * bubbles and its chat without sharing anything with the others.
 *
 * Connection rules:
 * - `onJoin`: a `Player` is added to the state under `client.sessionId`, with
 *   the name and avatar the user chose (validated; with a fallback).
 * - `onDrop` (NON-consented close: network down, hung tab): the player is
 *   marked as disconnected and their seat is held for
 *   `reconnectGraceSeconds`. If they reconnect in time they keep the session;
 *   if not, they fall through to `onLeave`.
 * - `onLeave` (consented close or expired grace): the player is removed and
 *   the state patch tells everyone else.
 *
 * Presence:
 * - Every `MOVE` (or name change) counts as activity. A player without
 *   activity for `awayAfterSeconds` becomes `away = true`; on moving again
 *   they go back to active.
 * - `SET_AWAY` sets the away state by hand (`awayManual`): moving does not
 *   clear it, only another `SET_AWAY { away: false }`.
 *
 * Focus desks (see `seat` in `docs/map.md`): `SIT` takes the name of a seat
 * in this world's map and, if it exists and nobody is in it, pins the player
 * there (`seatId`, position, facing) — that is the whole "focused" state, and
 * with it the seat is taken for everyone. `STAND` clears it, and so does
 * anything that means the person is no longer there: going away, the
 * connection dropping, or leaving the room (through a door or by closing the
 * tab). The server is the only writer, so a seat can never be held by two
 * people nor kept by someone who has gone.
 *
 * Conversation bubbles (see `bubbles.ts`): membership is recomputed after
 * every clamped `MOVE` and on every departure. The client has no message to
 * request or force a bubble: it only reflects `state.bubbles` and
 * `player.bubbleId`.
 *
 * Bubble chat (see `chat.ts`): `CHAT_SEND` is relayed only to the members the
 * sender's bubble has at that moment (the sender included, as an
 * acknowledgement). Messages are ephemeral: they do not enter the state nor
 * get stored anywhere, so whoever arrives later sees nothing from before.
 *
 * The server is the source of truth for the list of players and the bubbles:
 * the client only reflects `state.players` and `state.bubbles`.
 *
 * Map: on creation, the room takes its world's map (the same Tiled file the
 * client draws) and from it the spawn points and the bounds. The maps of
 * every world are read and validated together at boot -- doors included: if
 * any of them is invalid, the server does not start.
 *
 * Doors: travelling is leaving this room and joining the destination world's
 * one. The destination room receives in `options.spawn` the name of the
 * arrival point the door names, and in `options.away` the presence state of
 * whoever travels.
 */
export class WorldRoom extends Room<{ state: OfficeState }> {
  /** The room lives even with nobody in it: everyone in that world joins the same one. */
  autoDispose = false
  maxClients = config.maxClients
  state = new OfficeState()
  /** The world this room hosts. */
  world!: WorldDefinition
  map!: WorldMap
  bubbles!: BubbleManager
  chat!: ChatRelay
  /** Latest instant (ms, room clock) with activity, by sessionId. */
  private lastActivity = new Map<string, number>()

  async onCreate(options?: WorldRoomOptions) {
    // The world comes from the name the room was registered under; the
    // `defineRoom` options are the fallback (and what the tests use).
    const world = worldForRoomName(this.roomName) ?? getWorld(options?.worldId ?? '')
    if (!world) {
      throw new MapError(
        `The room "${this.roomName}" does not match any configured world (see WORLDS in @vto/shared)`,
      )
    }
    this.world = world
    this.map = worldMap(world.id)
    console.log(
      `[world ${world.id}] map ${this.map.file} (${this.map.bounds.width}x${this.map.bounds.height} px, entrance ${this.map.spawn.x},${this.map.spawn.y})`,
    )

    this.bubbles = new BubbleManager(this.state, {
      radius: config.bubbleRadiusPx ?? DEFAULT_BUBBLE_RADIUS_TILES * this.map.data.tilewidth,
      maxMembers: config.bubbleMaxMembers,
    })
    console.log(
      `[world ${world.id}] bubbles: radius ${this.bubbles.radius} px, cap ${this.bubbles.maxMembers} members`,
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
    this.onMessage(Message.SIT, (client, payload: SitPayload) => this.onSit(client, payload))
    this.onMessage(Message.STAND, (client) => this.onStand(client))
    this.onMessage(Message.CHAT_SEND, (client, payload: ChatSendPayload) =>
      this.onChatSend(client, payload),
    )

    this.clock.setInterval(() => this.checkAway(), AWAY_CHECK_INTERVAL_MS)

    await this.setMetadata({ name: world.name, worldId: world.id })
    console.log(`[world ${world.id}] "${world.name}" ready (roomId=${this.roomId})`)
  }

  onJoin(client: Client, options?: JoinOptions) {
    // Whoever arrives through a door does so at the spawn that door names,
    // facing wherever that spawn says: with their back to the return door.
    const spawn = this.spawnFor(options?.spawn)
    const { x, y } = randomSpawnPosition(spawn, this.map.bounds)
    const away = options?.away === true
    const player = new Player({
      sessionId: client.sessionId,
      name: sanitizeName(options?.name) ?? guestName(client.sessionId),
      avatar: sanitizeAvatar(options?.avatar),
      appearance: sanitizeAppearance(options?.appearance),
      // How many agent mascots walk behind them. It is part of the identity
      // like the avatar is: validated here once, and from then on it is the
      // state that everyone reads.
      agents: sanitizeAgentCount(options?.agents),
      x,
      y,
      dir: spawn.dir,
      moving: false,
      // Travelling does not change the presence state: you arrive as you left.
      away,
      awayManual: away && options?.awayManual === true,
      connected: true,
    })
    this.state.players.set(client.sessionId, player)
    this.touch(client.sessionId)
    // Appearing next to someone also counts as being close.
    this.bubbles.onPlayerMoved(player)

    const info: RoomInfoPayload = {
      roomId: this.roomId,
      worldId: this.world.id,
      name: this.world.name,
      sessionId: client.sessionId,
    }
    client.send(Message.ROOM_INFO, info)
    console.log(
      `[world ${this.world.id}] ${client.sessionId} joins as "${player.name}" (${player.avatar}; ${player.agents} agents; spawn "${spawn.name}"; ${this.state.players.size} present)`,
    )
  }

  /**
   * The spawn someone enters through: the one the door they crossed names or,
   * if it names none (or names one this map does not have), the entrance to
   * the world. The cross-validation at boot already guarantees that real
   * doors point at spawns that exist; this covers an inventive client.
   */
  private spawnFor(name?: string): SpawnPoint {
    const wanted = typeof name === 'string' ? name.trim() : ''
    if (wanted === '') return this.map.spawn
    try {
      return findSpawnPoint(this.map.data, wanted)
    } catch {
      console.warn(`[world ${this.world.id}] unknown spawn "${wanted}"; using the entrance`)
      return this.map.spawn
    }
  }

  /**
   * The client sends its position already resolved against the map's
   * collisions; the server clamps it to the bounds and replicates it along
   * with the animation. (Validating collisions server-side is left for later.)
   */
  private onMove(client: Client, payload: MovePayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const x = Number(payload?.x)
    const y = Number(payload?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (player.seatId !== '') {
      // Sitting pins you to the chair: the position the client reports is not
      // applied. Only a position whose body is clear of the seat stands you
      // up — measured with the very rectangle the client uses to offer the
      // seat in the first place, so a `MOVE` still in flight from the instant
      // before sitting down (sent from the rim of that same rectangle) cannot
      // knock you straight back out of the chair.
      const seat = seatByName(this.map.data, player.seatId)
      if (seat && isAtSeat(seat, x, y)) return
      this.release(player)
    }
    player.x = clamp(Math.round(x), 0, this.map.bounds.width)
    player.y = clamp(Math.round(y), 0, this.map.bounds.height)
    if (isDirection(payload.dir)) player.dir = payload.dir
    player.moving = payload.moving === true
    this.markActive(player)
    // Bubble membership is decided here, with the position already clamped.
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
      // Away and focused are two different things, and stepping away from the
      // keyboard is not holding a desk: the seat goes back into the pool.
      this.release(player)
      player.away = true
      player.awayManual = true
    } else {
      player.away = false
      player.awayManual = false
      this.touch(client.sessionId)
    }
  }

  /**
   * Sitting down at a focus desk. The seat has to exist in this world's map
   * and be free: the client already knows both from the state, so a refusal
   * means it raced someone else, and the state it gets back (unchanged) is
   * the answer. Whoever sits is pinned to the seat, so everyone draws them in
   * the same chair, facing the same way.
   */
  private onSit(client: Client, payload: SitPayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const seat = seatByName(this.map.data, String(payload?.seat ?? ''))
    if (!seat || this.sitterAt(seat.name)) return
    if (player.seatId === seat.name) return

    player.seatId = seat.name
    const { x, y } = seatAnchor(seat)
    player.x = x
    player.y = y
    player.dir = seat.dir
    player.moving = false
    // Sitting down to work is the opposite of having stepped away, so it
    // clears the away state even when it was set by hand: that way focused
    // and away never hold at once and the status shown is never ambiguous.
    player.away = false
    player.awayManual = false
    this.markActive(player)
    // Focused is outside the conversations: this is what takes them out of
    // the bubble they were in and keeps them out while they are sitting.
    this.bubbles.onPlayerMoved(player)
  }

  /** Standing up: back to being present and available like everyone else. */
  private onStand(client: Client) {
    const player = this.state.players.get(client.sessionId)
    if (!player || player.seatId === '') return
    this.release(player)
    this.markActive(player)
    // Standing up next to someone opens a conversation there and then.
    this.bubbles.onPlayerMoved(player)
  }

  /** Whoever is sitting at that seat, if anybody. */
  private sitterAt(seatId: string): Player | undefined {
    let found: Player | undefined
    this.state.players.forEach((player) => {
      if (player.seatId === seatId) found = player
    })
    return found
  }

  /**
   * Frees the seat the player was holding, if any. Every way of ceasing to be
   * heads-down goes through here, so no seat is left taken by somebody who is
   * no longer sitting in it.
   */
  private release(player: Player) {
    player.seatId = ''
  }

  /**
   * Chat message: `ChatRelay` resolves it (validates, requires a bubble and
   * limits the rate) and the server sends it only to the clients in that
   * bubble. If it is not accepted, the reason goes back to the sender alone.
   * Nothing is stored.
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
    // Typing is activity too: it does not mark you away while you chat.
    const player = this.state.players.get(client.sessionId)
    if (player) this.markActive(player)
  }

  /** Records activity; the automatic away state lifts, the manual one does not. */
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
      // Sitting at a focus desk IS the activity: being heads-down without
      // touching a key is the whole point, so the inactivity sweep leaves
      // whoever is focused alone. Away while seated only happens by hand,
      // and that frees the desk (see `onSetAway`).
      if (isFocused(player)) return
      const last = this.lastActivity.get(sessionId) ?? now
      if (now - last >= limit) player.away = true
    })
  }

  onDrop(client: Client, code?: number) {
    // If the server is shutting down there is no point in holding the seat:
    // without allowReconnection the framework goes straight to onLeave().
    if (code === CloseCode.SERVER_SHUTDOWN) return

    const player = this.state.players.get(client.sessionId)
    if (player) {
      player.connected = false
      // The place in the room is held for them; the desk is not. Somebody
      // whose connection went is not working at it, and the next person to
      // come along should be able to use it.
      this.release(player)
      this.bubbles.onPlayerMoved(player)
    }
    console.log(
      `[world ${this.world.id}] ${client.sessionId} dropped (code=${code}); holding the seat for ${config.reconnectGraceSeconds}s`,
    )
    // The result is not awaited: the framework routes to onReconnect() or
    // onLeave(). The catch avoids an "unhandled rejection" while the room is
    // closing.
    this.allowReconnection(client, config.reconnectGraceSeconds).catch(() => {})
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId)
    if (player) player.connected = true
    console.log(`[world ${this.world.id}] ${client.sessionId} reconnected`)
  }

  onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId)
    // They are removed from the state first and the bubbles are recomputed
    // afterwards: that way those who are freed do not group up again with
    // someone who has already gone.
    this.state.players.delete(client.sessionId)
    if (player) this.bubbles.onPlayerLeft(player)
    this.lastActivity.delete(client.sessionId)
    this.chat.forget(client.sessionId)
    const reason = code === CloseCode.CONSENTED ? 'consented leave' : `code=${code}`
    console.log(
      `[world ${this.world.id}] ${client.sessionId} leaves (${reason}; ${this.state.players.size} present)`,
    )
  }

  onDispose() {
    console.log(`[world ${this.world.id}] "${this.world.name}" closed (roomId=${this.roomId})`)
  }
}
