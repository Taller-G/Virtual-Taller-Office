import { Room, type Client, CloseCode } from 'colyseus'
import {
  clamp,
  findSpawnPoint,
  freeStandingSpots,
  getWorld,
  guestName,
  isAtSeat,
  isDirection,
  isFocused,
  isInMeeting,
  MapError,
  Meeting,
  meetingRoomByName,
  MeetingPerson,
  MeetingRoomInfo,
  Message,
  newPersonId,
  OfficeState,
  Player,
  playerBodyRect,
  randomSpawnPosition,
  rectContains,
  sanitizeAgentCount,
  sanitizeAgentType,
  sanitizeAppearance,
  sanitizeAvatar,
  sanitizeName,
  sanitizePersonId,
  seatAnchor,
  seatByName,
  worldForRoomName,
  type ChatSendPayload,
  type Direction,
  type JoinOptions,
  type MeetingActionPayload,
  type MeetingEndedPayload,
  type MeetingErrorPayload,
  type MeetingRejection,
  type MeetingRoom,
  type MeetingSchedulePayload,
  type MovePayload,
  type Rect,
  type RoomInfoPayload,
  type SetAwayPayload,
  type SetNamePayload,
  type WaveSendPayload,
  type SitPayload,
  type SpawnPoint,
  type WorldDefinition,
} from '@vto/shared'
import { BubbleManager } from '../bubbles'
import { ChatRelay } from '../chat'
import { WaveRelay } from '../waves'
import { config, DEFAULT_BUBBLE_RADIUS_TILES } from '../config'
import { worldMap, type WorldMap } from '../map'
import { meetings, type MeetingPersonRecord, type MeetingRecord } from '../meetings'

/** What `defineRoom` passes to each world's room (see `app.config.ts`). */
export interface WorldRoomOptions {
  worldId?: string
}

/** How often it is checked who has gone too long without activity. */
const AWAY_CHECK_INTERVAL_MS = 1_000
/** How often it is checked whether a meeting's time is up. */
const MEETING_CHECK_INTERVAL_MS = 1_000

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
 *
 * Meetings (see `meetings.ts`): the meetings themselves live in one book
 * shared by every world's room, and this room mirrors it into
 * `state.meetings` so the panel shows the same list wherever somebody is
 * standing. What this room owns is the world: `MEETING_ENTER` puts the person
 * in a chair around that room's big table — or, when every chair is taken, on
 * free floor inside the room — in one step, with no walking, and into the
 * meeting's conversation, which is a bubble that distance does not decide.
 * Everything that means they are no longer at that table (standing up,
 * walking off the seat, going away by hand, dropping, leaving the world)
 * takes them out of the meeting as well. When a meeting's time is up, or its
 * organiser cancels it, the participants are told and the conversation
 * dissolves; whoever is still sitting simply reads as Focused.
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
  waves!: WaveRelay
  /** Latest instant (ms, room clock) with activity, by sessionId. */
  private lastActivity = new Map<string, number>()
  /** Stops mirroring the book of meetings when the room closes. */
  private unwatchMeetings?: () => void

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

    this.waves = new WaveRelay(this.state, { cooldownMs: config.waveCooldownMs })

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
    this.onMessage(Message.WAVE_SEND, (client, payload: WaveSendPayload) =>
      this.onWaveSend(client, payload),
    )
    this.onMessage(Message.MEETING_SCHEDULE, (client, payload: MeetingSchedulePayload) =>
      this.onMeetingSchedule(client, payload),
    )
    this.onMessage(Message.MEETING_CANCEL, (client, payload: MeetingActionPayload) =>
      this.onMeetingCancel(client, payload),
    )
    this.onMessage(Message.MEETING_ENTER, (client, payload: MeetingActionPayload) =>
      this.onMeetingEnter(client, payload),
    )
    this.onMessage(Message.MEETING_LEAVE, (client) => this.onMeetingLeave(client))

    // The rooms a meeting can be booked into come off the worlds' maps and do
    // not change while the server runs; the meetings themselves do.
    for (const room of meetings.roomList()) {
      this.state.meetingRooms.push(new MeetingRoomInfo(room))
    }
    this.unwatchMeetings = meetings.subscribe((change) => {
      if (change.closed) this.closeMeeting(change.closed.meeting, change.closed.reason)
      this.syncMeetings()
    })
    this.syncMeetings()

    this.clock.setInterval(() => this.checkAway(), AWAY_CHECK_INTERVAL_MS)
    // Wall-clock time, not the room's: a meeting's end is an hour of the day,
    // and every room has to reach the same conclusion about it.
    this.clock.setInterval(() => meetings.sweep(Date.now()), MEETING_CHECK_INTERVAL_MS)

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
      // Who this is across worlds. The client keeps one per tab; anything
      // unusable — or one somebody already in this room is using — is replaced
      // with a fresh one, so two people are never the same person.
      personId: this.personIdFor(options?.personId),
      name: sanitizeName(options?.name) ?? guestName(client.sessionId),
      avatar: sanitizeAvatar(options?.avatar),
      appearance: sanitizeAppearance(options?.appearance),
      // How many agent mascots walk behind them, and what they look like. Both
      // are part of the identity like the avatar is: validated here once, and
      // from then on it is the state that everyone reads. An unknown type — an
      // old client, a new one, an inventive one — enters as the classic robot
      // rather than as a texture nobody can load.
      agents: sanitizeAgentCount(options?.agents),
      agentType: sanitizeAgentType(options?.agentType),
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
      `[world ${this.world.id}] ${client.sessionId} joins as "${player.name}" (${player.avatar}; ${player.agents} ${player.agentType} agents; spawn "${spawn.name}"; ${this.state.players.size} present)`,
    )

    // Crossing over in order to enter a meeting: the trip and the seat are one
    // action, so they arrive already at the table rather than at the entrance
    // for an instant first. The rules are the same ones `MEETING_ENTER`
    // applies; a refusal leaves them standing at the spawn with the reason.
    const wanted = typeof options?.meeting === 'string' ? options.meeting.trim() : ''
    if (wanted !== '') {
      const refusal = this.enterMeeting(player, wanted, Date.now())
      if (refusal) this.refuseMeeting(client, refusal)
    }
  }

  /**
   * A `personId` nobody else in this room is using: the one the client sent if
   * it is usable, a fresh one otherwise. The clash it guards against is the
   * ordinary one — a tab whose connection dropped without notice rejoining
   * while the server still holds its old player — not an attack.
   */
  private personIdFor(wanted: unknown): string {
    const id = sanitizePersonId(wanted)
    if (!id) return newPersonId()
    let taken = false
    this.state.players.forEach((other) => {
      if (other.personId === id) taken = true
    })
    return taken ? newPersonId() : id
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
      // keyboard is not holding a desk: the seat goes back into the pool, and
      // so does the place at a meeting table. Stepping away from a meeting is
      // leaving it; the automatic sweep, which never fires on a participant,
      // is the one that does not.
      this.release(player)
      player.away = true
      player.awayManual = true
      this.bubbles.onPlayerMoved(player)
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
   * Frees the seat the player was holding, if any, and with it the meeting
   * they were at the table of. Every way of ceasing to be there goes through
   * here — standing up, walking off the chair, going away by hand, dropping,
   * leaving the world — so no seat is left taken by somebody who is no longer
   * sitting in it, and no meeting lists somebody who has got up and gone.
   *
   * The caller recomputes the bubbles afterwards: the position it wants them
   * computed from is usually not the one the player has at this instant.
   */
  private release(player: Player) {
    player.seatId = ''
    if (player.meetingId !== '') {
      meetings.leave(player.personId)
      player.meetingId = ''
    }
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

  /**
   * Wave: `WaveRelay` resolves it (both people in the room, not oneself, off
   * cooldown) and it goes to the person waved at alone. A rejected wave is
   * answered with silence on purpose - the client holds the same cooldown, so
   * the only way to reach one here is a client that ignored it, and there is
   * nothing useful to tell it.
   */
  private onWaveSend(client: Client, payload: WaveSendPayload) {
    const outcome = this.waves.submit(client.sessionId, payload, Date.now())
    if (!outcome.ok) return
    this.clients.getById(outcome.to)?.send(Message.WAVE, outcome.wave)
    // Waving is activity: it does not leave you marked away.
    const player = this.state.players.get(client.sessionId)
    if (player) this.markActive(player)
  }

  // ---------------------------------------------------------------------------
  // Meetings
  // ---------------------------------------------------------------------------

  /**
   * Schedules a meeting. Everything about whether it is allowed is the book's
   * decision (title, time, duration, and whether the room is free); what this
   * adds is the names: a client sends `personId`s, and the panel that reads
   * the list back — possibly from another world — needs the people spelled
   * out. Anybody named who is not in this world is dropped rather than
   * invited as a name nobody can read.
   */
  private onMeetingSchedule(client: Client, payload: MeetingSchedulePayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const wanted = Array.isArray(payload?.invited) ? payload.invited : []
    const invitees: MeetingPersonRecord[] = []
    for (const personId of wanted) {
      const person = this.personNamed(String(personId))
      if (person) invitees.push(person)
    }

    const outcome = meetings.schedule(payload, this.personOf(player), Date.now(), invitees)
    if (!outcome.ok) {
      this.refuseMeeting(client, outcome.reason, outcome.conflict)
      return
    }
    this.markActive(player)
    console.log(
      `[world ${this.world.id}] ${player.name} scheduled "${outcome.meeting.title}" in ${outcome.meeting.room} (${outcome.meeting.invited.length} invited)`,
    )
  }

  /** Cancelling: only the organiser, and only while the meeting is still there. */
  private onMeetingCancel(client: Client, payload: MeetingActionPayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const outcome = meetings.cancel(String(payload?.meetingId ?? ''), player.personId, Date.now())
    if (!outcome.ok) this.refuseMeeting(client, outcome.reason)
    else this.markActive(player)
  }

  /**
   * Entering a meeting held in **this** world. A meeting somewhere else is the
   * client's business first: it crosses the door and asks for the seat on
   * arrival (see `onJoin`), so a world that is down leaves it where it was.
   */
  private onMeetingEnter(client: Client, payload: MeetingActionPayload) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    const refusal = this.enterMeeting(player, String(payload?.meetingId ?? ''), Date.now())
    if (refusal) this.refuseMeeting(client, refusal)
  }

  /** Leaving by hand. Standing up does the same thing (see `release`). */
  private onMeetingLeave(client: Client) {
    const player = this.state.players.get(client.sessionId)
    if (!player || player.meetingId === '') return
    this.release(player)
    this.markActive(player)
    // On their feet where the meeting left them, back to ordinary proximity.
    this.bubbles.onPlayerMoved(player)
  }

  /**
   * Puts the player in the meeting: a free chair at that room's big table, or
   * — when every chair is taken — free floor inside the room, which is still
   * being in the meeting. One step and no walking either way.
   *
   * Returns why it was refused, or `undefined` if they are in.
   */
  private enterMeeting(
    player: Player,
    meetingId: string,
    now: number,
  ): MeetingRejection | undefined {
    const meeting = meetings.get(meetingId)
    if (!meeting) return 'not_found'
    // The meeting is in another world: they have to get there first.
    if (meeting.worldId !== this.world.id) return 'travel_failed'
    if (player.meetingId === meeting.id) return 'already_in'

    // Whatever they were in before ends here: one conversation at a time.
    if (player.meetingId !== '') this.release(player)

    const outcome = meetings.enter(meeting.id, this.personOf(player), now)
    if (!outcome.ok) return outcome.reason

    if (!this.placeInMeetingRoom(player, meeting)) {
      // Nowhere to put them: the book goes back as it was, and they have not
      // moved. The maps are validated for this, so it means a broken one.
      meetings.leave(player.personId)
      return 'travel_failed'
    }
    player.meetingId = meeting.id
    // Being in a meeting is being at work, not away: it clears the away state
    // even when it was set by hand, the same way sitting down does.
    player.away = false
    player.awayManual = false
    this.markActive(player)
    this.bubbles.joinMeeting(meeting.id, player)
    console.log(
      `[world ${this.world.id}] ${player.name} entered "${meeting.title}" in ${meeting.room} (seat "${player.seatId || 'standing'}")`,
    )
    return undefined
  }

  /**
   * Where somebody ends up when they enter: the first free seat at the table,
   * in the map's order, facing the table as that seat says. With every seat
   * taken they are stood on free floor **inside the room** — never on a chair,
   * never outside — facing the table, which is what makes a full table an
   * ordinary outcome instead of a refusal.
   */
  private placeInMeetingRoom(player: Player, meeting: MeetingRecord): boolean {
    const room = meetingRoomByName(this.map.data, meeting.room)
    if (!room) return false

    const seat = room.seats.find((candidate) => !this.sitterAt(candidate.name))
    if (seat) {
      player.seatId = seat.name
      const { x, y } = seatAnchor(seat)
      player.x = x
      player.y = y
      player.dir = seat.dir
      player.moving = false
      return true
    }

    const blocked: Rect[] = [...room.seats, ...this.bodiesIn(room, player)]
    const spot = freeStandingSpots(this.map.data, room, blocked)[0]
    if (!spot) return false
    player.seatId = ''
    player.x = spot.x
    player.y = spot.y
    player.dir = facing(spot, { x: room.x + room.width / 2, y: room.y + room.height / 2 })
    player.moving = false
    return true
  }

  /** The bodies of everybody else standing inside that room right now. */
  private bodiesIn(room: MeetingRoom, except: Player): Rect[] {
    const bodies: Rect[] = []
    this.state.players.forEach((other) => {
      if (other === except || !rectContains(room, other.x, other.y)) return
      bodies.push(playerBodyRect(other.x, other.y))
    })
    return bodies
  }

  /** The meeting is over: everyone in it is told, and the conversation dissolves. */
  private closeMeeting(meeting: MeetingRecord, reason: 'cancelled' | 'ended') {
    const payload: MeetingEndedPayload = {
      meetingId: meeting.id,
      title: meeting.title,
      reason,
    }
    this.state.players.forEach((player, sessionId) => {
      if (player.meetingId !== meeting.id) return
      // The seat is left alone on purpose: whoever stays sitting is simply
      // focused at that chair now, like at any other desk.
      player.meetingId = ''
      this.clients.getById(sessionId)?.send(Message.MEETING_ENDED, payload)
    })
    // After clearing their `meetingId`, so that those left standing next to
    // somebody open an ordinary bubble there and then.
    this.bubbles.closeMeeting(meeting.id)
  }

  /** How the book names this player. */
  private personOf(player: Player): MeetingPersonRecord {
    return { personId: player.personId, name: player.name }
  }

  /** That person, if they are in this world. */
  private personNamed(personId: string): MeetingPersonRecord | undefined {
    let found: MeetingPersonRecord | undefined
    this.state.players.forEach((player) => {
      if (player.personId === personId) found = this.personOf(player)
    })
    return found
  }

  private refuseMeeting(client: Client, reason: MeetingRejection, conflict?: MeetingRecord) {
    const payload: MeetingErrorPayload = { reason }
    if (conflict) {
      payload.conflict = {
        title: conflict.title,
        startsAt: conflict.startsAt,
        endsAt: conflict.endsAt,
      }
    }
    client.send(Message.MEETING_ERROR, payload)
  }

  /**
   * Mirrors the book into this room's state. A meeting's title, time and room
   * never change, so only the people are kept in step; a meeting that has left
   * the book (ended or cancelled) leaves the state with it, which is what
   * makes it disappear from every panel at once.
   */
  private syncMeetings() {
    const present = new Set<string>()
    for (const record of meetings.list()) {
      present.add(record.id)
      let meeting = this.state.meetings.get(record.id)
      if (!meeting) {
        meeting = new Meeting({
          id: record.id,
          title: record.title,
          worldId: record.worldId,
          room: record.room,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
          organiser: record.organiser,
          organiserName: record.organiserName,
        })
        for (const person of record.invited) meeting.invited.push(new MeetingPerson(person))
        this.state.meetings.set(record.id, meeting)
      }
      syncPeople(meeting, record.participants)
    }
    for (const id of [...this.state.meetings.keys()]) {
      if (!present.has(id)) this.state.meetings.delete(id)
    }
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
      // whoever is focused alone. Being in a meeting is the same: listening
      // without typing is what a meeting mostly is, and nobody should drop to
      // away in the middle of one. Away in either state only happens by hand,
      // and that frees the desk (see `onSetAway`).
      if (isFocused(player) || isInMeeting(player)) return
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
    if (player) {
      this.bubbles.onPlayerLeft(player)
      // Leaving the world is leaving the meeting: the chair goes back into the
      // pool and the participant list stops naming somebody who is not there.
      // The meeting itself carries on for the others.
      if (player.meetingId !== '') meetings.leave(player.personId)
    }
    this.lastActivity.delete(client.sessionId)
    this.chat.forget(client.sessionId)
    this.waves.forget(client.sessionId)
    const reason = code === CloseCode.CONSENTED ? 'consented leave' : `code=${code}`
    console.log(
      `[world ${this.world.id}] ${client.sessionId} leaves (${reason}; ${this.state.players.size} present)`,
    )
  }

  onDispose() {
    this.unwatchMeetings?.()
    this.unwatchMeetings = undefined
    console.log(`[world ${this.world.id}] "${this.world.name}" closed (roomId=${this.roomId})`)
  }
}

/**
 * Keeps a meeting's participants in step with the book. They change one at a
 * time and rarely, so when anything differs the list is rewritten rather than
 * patched position by position: the shortest thing that is certainly right.
 */
function syncPeople(meeting: Meeting, people: readonly MeetingPersonRecord[]) {
  const same =
    meeting.participants.length === people.length &&
    people.every((person, index) => meeting.participants.at(index)?.personId === person.personId)
  if (same) return
  meeting.participants.clear()
  for (const person of people) meeting.participants.push(new MeetingPerson(person))
}

/** Which way to face to be looking at a point: the bigger axis wins. */
function facing(from: { x: number; y: number }, to: { x: number; y: number }): Direction {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}
