import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import {
  DEFAULT_WORLD_ID,
  doorAtRect,
  getWorld,
  Message,
  seatAtRect,
  seatByName,
  worldName,
  type Direction,
  type Door,
  type MovePayload,
  type Player,
  type Seat,
  type SitPayload,
} from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { toast } from '../ui/toasts'
import { Avatar, BODY } from './Avatar'
import { createAvatarAnims } from './avatarAnims'
import { BubbleArea } from './BubbleArea'
import { MascotTrain } from './MascotTrain'
import { createMascotAnims } from './mascotAnims'
import { buildOfficeMap, drawCollisionDebug, type BuiltMap } from './officeMap'
import { SeatHint, SIT_KEY } from './SeatHint'
import { isTyping } from './typingGuard'
import { loadWorld } from './worldAssets'

/** Walking speed, px/s. */
const SPEED = 150
/** Camera zoom: an integer so the pixel art does not look blurry. */
const CAMERA_ZOOM = 2
/** How often, at most, one's own position is sent to the server (20 times/s). */
const SEND_INTERVAL_MS = 50
/** Duration of the fade when crossing a door (out and in), in ms. */
const FADE_MS = 220

interface Keys {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  /** Sits down at the seat under the feet, and stands up again. */
  sit: Phaser.Input.Keyboard.Key
}

interface Sent {
  x: number
  y: number
  dir: Direction
  moving: boolean
  at: number
}

/**
 * The office scene: it draws the Tiled map with its collisions and one avatar
 * per player present in the room's state. Your own moves with the arrow keys /
 * WASD (Arcade physics against walls and furniture) and sends position and
 * animation to the server at most 20 times per second, only when they change.
 * The others slide towards the latest position received.
 *
 * The list of avatars mirrors `state.players` exactly: they are created in
 * `onAdd` and destroyed in `onRemove`; nothing else adds or retains them.
 *
 * The conversation bubbles are drawn the same way: one area per entry in
 * `state.bubbles`, with the radius the server sends. Your own is highlighted
 * and the avatars of the people you are with carry a ring at their feet.
 * Membership is never computed here: it comes from `player.bubbleId`.
 *
 * Bubble chat messages appear as a balloon over the author's avatar and are
 * not stored: the balloon goes away on its own (see `Avatar.say`).
 *
 * Focus desks: standing on an object of class `seat` shows a hint over it,
 * and pressing that key asks the server to sit down. Being seated is not
 * decided here: `player.seatId` is written by the server alone, and this
 * scene only reflects it — it pins the body to the seat, draws the seated
 * pose (one's own and everyone else's) and stops the movement keys, which
 * instead stand the person up. That is why a refused seat (taken a moment
 * ago) needs no reply: nothing changed, so nothing is drawn.
 *
 * Agent mascots: each player carries `agents` robots in the state, and this
 * scene gives every avatar a `MascotTrain` that draws them and walks them
 * along their owner's path. They are decoration and nothing else: they have
 * no physics body, no name and no entry in any list, so nothing here — seats,
 * doors, bubbles, chat — ever asks about them.
 *
 * Doors: stepping on an object of class `door` in the map leads to another
 * world. There is no key press and no confirmation: as soon as the feet enter
 * the area, the scene fades to black, loads the destination's map, switches
 * room and restarts there. If the destination is unavailable, it says so and
 * you stay where you were.
 */
export class OfficeScene extends Phaser.Scene {
  /** World this scene is drawing. */
  private worldId = DEFAULT_WORLD_ID
  private map!: BuiltMap
  private avatars = new Map<string, Avatar>()
  /** The agent robots of each player, by sessionId (see `MascotTrain`). */
  private mascots = new Map<string, MascotTrain>()
  private bubbleAreas = new Map<string, BubbleArea>()
  private me?: Avatar
  private keys!: Keys
  private room?: OfficeRoom
  private unbindRoom: Array<() => void> = []
  private offRoom?: () => void
  private offChat?: () => void
  private lastSent: Sent = { x: NaN, y: NaN, dir: 'down', moving: false, at: 0 }
  private debug: boolean
  /** True while crossing a door: no other one fires and nobody moves. */
  private traveling = false
  /**
   * False while the avatar is still standing on a door from the moment it
   * arrived: it avoids bouncing straight back to the previous world without
   * having moved.
   */
  private doorArmed = false
  /** The hint over the seat under my feet (see `SeatHint`). */
  private seatHint?: SeatHint
  /** Seat I am sitting at according to the server, or `''` if I am standing. */
  private mySeatId = ''

  constructor(
    private connection: OfficeConnection,
    options: { debug?: boolean } = {},
  ) {
    super('office')
    this.debug = options.debug ?? false
  }

  /** The world comes from `BootScene` or from the restart after crossing a door. */
  init(data?: { worldId?: string }) {
    this.worldId = data?.worldId ?? this.connection.worldId ?? DEFAULT_WORLD_ID
    this.traveling = false
    this.doorArmed = false
    this.mySeatId = ''
  }

  create() {
    this.map = buildOfficeMap(this, this.worldId)
    this.cameras.main.fadeIn(FADE_MS)
    if (this.debug) drawCollisionDebug(this, this.map)
    createAvatarAnims(this)
    createMascotAnims(this)

    const camera = this.cameras.main
    camera.setBounds(0, 0, this.map.bounds.width, this.map.bounds.height)
    camera.setZoom(CAMERA_ZOOM)
    camera.setRoundPixels(true)
    if (this.map.spawn) camera.centerOn(this.map.spawn.x, this.map.spawn.y)

    this.physics.world.setBounds(0, 0, this.map.bounds.width, this.map.bounds.height)

    const keyboard = this.input.keyboard!
    const cursors = keyboard.createCursorKeys()
    const wasd = keyboard.addKeys('W,A,S,D') as Record<
      'W' | 'A' | 'S' | 'D',
      Phaser.Input.Keyboard.Key
    >
    this.keys = {
      up: [cursors.up, wasd.W],
      down: [cursors.down, wasd.S],
      left: [cursors.left, wasd.A],
      right: [cursors.right, wasd.D],
      sit: keyboard.addKey(SIT_KEY),
    }
    this.seatHint = new SeatHint(this)

    this.offRoom = this.connection.on('room', (room) => this.bindRoom(room))
    if (this.connection.room) this.bindRoom(this.connection.room)
    // Every message that arrives is from my bubble (the server already
    // filtered), so it is shown as a balloon over the avatar of whoever said
    // it, myself included.
    this.offChat = this.connection.on('chat', (message) =>
      this.avatars.get(message.from)?.say(message.text),
    )
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offRoom?.()
      this.offChat?.()
      this.seatHint?.destroy()
      this.seatHint = undefined
      this.clearRoom()
    })
  }

  update(time: number, delta: number) {
    if (this.me) this.moveMe(time)
    this.checkSeats()
    this.checkDoors()
    for (const avatar of this.avatars.values()) {
      if (!avatar.isMe) avatar.interpolate(delta)
    }
    // After the avatars have moved: the robots follow where their player is
    // now drawn, not where they were a frame ago.
    for (const [sessionId, train] of this.mascots) {
      const avatar = this.avatars.get(sessionId)
      if (avatar) train.update(delta, avatar)
    }
    for (const area of this.bubbleAreas.values()) area.interpolate(delta)
  }

  private moveMe(time: number) {
    const me = this.me!
    const body = me.body as Phaser.Physics.Arcade.Body
    if (this.traveling) {
      body.setVelocity(0, 0)
      me.playAnim('idle', me.dir)
      return
    }
    // With the focus in a text field the keys do not move the avatar.
    const typing = isTyping()
    const down = (keys: Phaser.Input.Keyboard.Key[]) => !typing && keys.some((k) => k.isDown)
    const dx = (down(this.keys.right) ? 1 : 0) - (down(this.keys.left) ? 1 : 0)
    const dy = (down(this.keys.down) ? 1 : 0) - (down(this.keys.up) ? 1 : 0)

    if (this.mySeatId !== '') {
      // Sitting: the body stays in the chair and the movement keys are what
      // gets you out of it. The position is not sent either — the server
      // pinned it when it granted the seat.
      body.setVelocity(0, 0)
      if (dx || dy) this.stand()
      return
    }

    if (dx || dy) {
      const length = Math.hypot(dx, dy)
      body.setVelocity((dx / length) * SPEED, (dy / length) * SPEED)
      // Diagonally the horizontal axis wins when choosing the sprite's direction.
      const dir: Direction = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up'
      me.playAnim('walk', dir)
    } else {
      body.setVelocity(0, 0)
      me.playAnim('idle', me.dir)
    }
    me.updateDepth()

    if (!this.room || time - this.lastSent.at < SEND_INTERVAL_MS) return
    const x = Math.round(me.x)
    const y = Math.round(me.y)
    const { dir, moving } = me
    const last = this.lastSent
    if (x === last.x && y === last.y && dir === last.dir && moving === last.moving) return
    this.lastSent = { x, y, dir, moving, at: time }
    const payload: MovePayload = { x, y, dir, moving }
    this.room.send(Message.MOVE, payload)
  }

  /**
   * The seat under my feet, if any. Same idiom as the doors: the **physics
   * body** is what is compared against the seat's rectangle, so standing on
   * the chair is enough.
   */
  private seatUnderMe(): Seat | undefined {
    if (!this.me?.body) return undefined
    const body = this.me.body as Phaser.Physics.Arcade.Body
    return seatAtRect(this.map.raw, {
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
    })
  }

  /** Who, if anybody, is sitting at that seat according to the server. */
  private sitterAt(seatId: string): string | undefined {
    const state = this.room?.state
    if (!state) return undefined
    let found: string | undefined
    state.players.forEach((player, sessionId) => {
      if (player.seatId === seatId) found = sessionId
    })
    return found
  }

  /**
   * The hint over the seat, and the key that sits down or stands up. What the
   * hint says comes from the server's state, so a seat somebody else took a
   * moment ago already reads as taken before it is pressed.
   */
  private checkSeats() {
    const hint = this.seatHint
    if (!hint || !this.me || this.traveling) return

    if (this.mySeatId !== '') {
      // Nothing is drawn in the world while sitting (see `SeatHint`); the key
      // still works, and the sidebar says so.
      hint.hide()
      if (this.sitPressed()) this.stand()
      return
    }

    const seat = this.seatUnderMe()
    if (!seat) {
      hint.hide()
      return
    }
    const taken = this.sitterAt(seat.name) !== undefined
    hint.show(seat, taken ? 'taken' : 'free')
    if (!taken && this.sitPressed()) {
      const payload: SitPayload = { seat: seat.name }
      this.room?.send(Message.SIT, payload)
    }
  }

  /** Was the sit key pressed this frame (and not while typing)? */
  private sitPressed(): boolean {
    return !isTyping() && Phaser.Input.Keyboard.JustDown(this.keys.sit)
  }

  private stand() {
    if (this.mySeatId === '') return
    this.room?.send(Message.STAND, {})
  }

  /**
   * Reflects what the server says about my seat: it pins the body to the
   * chair on sitting down and lets it go on standing up. Everyone's seated
   * pose (mine included) is drawn in `syncAnim`.
   */
  private applyMySeat(player: Player) {
    this.mySeatId = player.seatId
    const me = this.me
    if (!me) return
    if (player.seatId !== '') {
      me.setPosition(player.x, player.y)
      me.updateDepth()
      const body = me.body as Phaser.Physics.Arcade.Body | undefined
      body?.reset(player.x, player.y + BODY.offsetY)
      // Nothing of mine is in flight any more: the seat is the position.
      this.lastSent = {
        x: player.x,
        y: player.y,
        dir: player.dir as Direction,
        moving: false,
        at: 0,
      }
    }
    this.syncAnim(me, player)
  }

  /**
   * Am I standing on a door? The **physics body** (the feet, not the whole
   * sprite) is compared against the door's area: touching the threshold is
   * enough, like crossing a real door. The door is only "armed" again once the
   * body leaves the area, so arriving next to the return door does not bounce
   * back to the previous world.
   */
  private checkDoors() {
    if (!this.me?.body || this.traveling) return
    const body = this.me.body as Phaser.Physics.Arcade.Body
    const door = doorAtRect(this.map.raw, {
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
    })
    if (!door) {
      this.doorArmed = true
      return
    }
    if (!this.doorArmed) return
    void this.travel(door)
  }

  /**
   * Crossing a door: fade to black, destination map loaded, room switched and
   * scene restarted already in the new world. Any stumble leaves the player
   * where they were, with a notice and the screen back.
   */
  private async travel(door: Door) {
    const world = getWorld(door.world)
    if (!world) return
    this.traveling = true
    this.doorArmed = false
    const camera = this.cameras.main
    camera.fadeOut(FADE_MS)
    // While travelling, the room being left must not replace this scene: the
    // restart below hooks back up with the destination's room.
    this.offRoom?.()
    this.offRoom = undefined

    try {
      // The map first: if the destination does not load, the current world is not left.
      await loadWorld(this, world)
      const outcome = await this.connection.travelTo(door.world, door.spawn)
      if (!outcome.ok) throw new Error(outcome.reason)
    } catch (error) {
      toast(error instanceof Error ? error.message : `Could not travel to ${worldName(door.world)}`)
      this.offRoom = this.connection.on('room', (room) => this.bindRoom(room))
      camera.fadeIn(FADE_MS)
      this.traveling = false
      return
    }

    this.scene.restart({ worldId: door.world })
  }

  /** A new room fully replaces whatever was there (rejoining included). */
  private bindRoom(room: OfficeRoom) {
    this.clearRoom()
    this.room = room
    const $ = Callbacks.get(room)

    this.unbindRoom.push(
      $.onAdd('players', (player, sessionId) => {
        const isMe = sessionId === room.sessionId
        const avatar = this.addAvatar(player, sessionId, isMe)
        this.unbindRoom.push(
          $.listen(player, 'connected', (connected) => avatar.setConnected(connected)),
          $.listen(player, 'away', (away) => avatar.setAway(away)),
          $.listen(player, 'name', (name) => avatar.setLabel(name)),
          $.listen(player, 'avatar', (id) => avatar.setAvatar(id)),
          $.listen(player, 'appearance', (raw) => avatar.setAppearance(raw)),
          $.listen(player, 'agents', (agents) =>
            this.mascots.get(sessionId)?.setCount(agents, avatar),
          ),
          $.listen(player, 'bubbleId', () => this.refreshBubbles()),
        )
        // This client sends its own position and animation: they are not overwritten by the echo.
        if (isMe) {
          // Except the seat: sitting down is the server's decision, and with
          // it come the position and the facing it pinned me to.
          this.unbindRoom.push($.listen(player, 'seatId', () => this.applyMySeat(player)))
        } else {
          this.unbindRoom.push(
            $.listen(player, 'x', (x) => avatar.setTarget({ x })),
            $.listen(player, 'y', (y) => avatar.setTarget({ y })),
            $.listen(player, 'dir', () => this.syncAnim(avatar, player)),
            $.listen(player, 'moving', () => this.syncAnim(avatar, player)),
            $.listen(player, 'seatId', () => this.syncAnim(avatar, player)),
          )
        }
      }),
      $.onRemove('players', (_player, sessionId) => {
        this.removeAvatar(sessionId)
        this.refreshBubbles()
      }),
      $.onAdd('bubbles', (bubble, id) => {
        const area = new BubbleArea(this, bubble, this.bubbleRadius(), false)
        this.bubbleAreas.set(id, area)
        this.unbindRoom.push(
          $.listen(bubble, 'x', (x) => area.setTarget({ x })),
          $.listen(bubble, 'y', (y) => area.setTarget({ y })),
          $.onAdd(bubble, 'members', () => this.refreshBubbles()),
          $.onRemove(bubble, 'members', () => this.refreshBubbles()),
        )
        this.refreshBubbles()
      }),
      $.onRemove('bubbles', (_bubble, id) => {
        this.bubbleAreas.get(id)?.destroy(true)
        this.bubbleAreas.delete(id)
        this.refreshBubbles()
      }),
      // The radius arrives with the initial state; if it changed, it is redrawn.
      $.listen('bubbleRadius', (radius) => {
        for (const area of this.bubbleAreas.values()) area.setRadius(radius)
      }),
    )
  }

  /** Radius of the bubbles according to the server (0 until the state arrives). */
  private bubbleRadius(): number {
    return this.room?.state.bubbleRadius ?? 0
  }

  /**
   * Redraws the highlight: which area is mine, how many of us there are and
   * which avatars are in my bubble. All of it comes from the server's state.
   */
  private refreshBubbles() {
    const state = this.room?.state
    if (!state) return
    const myBubbleId = state.players.get(this.room!.sessionId)?.bubbleId ?? ''
    for (const [id, area] of this.bubbleAreas) {
      const mine = id === myBubbleId
      area.setMine(mine)
      area.setRadius(this.bubbleRadius())
      area.setCount(state.bubbles.get(id)?.members.length ?? 0)
    }
    for (const [sessionId, avatar] of this.avatars) {
      const bubbleId = state.players.get(sessionId)?.bubbleId ?? ''
      avatar.setInBubble(myBubbleId !== '' && bubbleId === myBubbleId)
    }
  }

  private syncAnim(avatar: Avatar, player: Player) {
    const dir = player.dir as Direction
    // Seated comes first: it is a still pose, not an animation, and it is the
    // same for the person themself and for everyone watching. The seat also
    // gives the depth to draw at, so the sitter is in the chair and not
    // hidden behind it.
    const seat = player.seatId ? seatByName(this.map.raw, player.seatId) : undefined
    avatar.setSeated(seat !== undefined, dir, seat && seat.y + seat.height + 1)
    if (!seat) avatar.playAnim(player.moving ? 'walk' : 'idle', dir)
  }

  private clearRoom() {
    for (const unbind of this.unbindRoom.splice(0)) unbind()
    for (const sessionId of [...this.avatars.keys()]) this.removeAvatar(sessionId)
    for (const train of this.mascots.values()) train.destroy()
    this.mascots.clear()
    for (const area of this.bubbleAreas.values()) area.destroy(true)
    this.bubbleAreas.clear()
    this.room = undefined
    this.me = undefined
    this.mySeatId = ''
    this.seatHint?.hide()
  }

  private addAvatar(player: Player, sessionId: string, isMe: boolean): Avatar {
    this.removeAvatar(sessionId)
    const avatar = new Avatar(this, player.x, player.y, {
      avatar: player.avatar,
      appearance: player.appearance,
      name: player.name,
      isMe,
    })
    avatar.setConnected(player.connected)
    avatar.setAway(player.away)
    this.syncAnim(avatar, player)
    this.avatars.set(sessionId, avatar)
    this.mascots.set(sessionId, new MascotTrain(this, avatar, player.agents))
    this.refreshBubbles()

    if (isMe) {
      this.me = avatar
      this.physics.add.existing(avatar)
      const body = avatar.body as Phaser.Physics.Arcade.Body
      body.setOffset(0, BODY.offsetY)
      body.setCollideWorldBounds(true)
      this.physics.add.collider(avatar, this.map.collisionLayers)
      this.physics.add.collider(avatar, this.map.solids)
      this.cameras.main.startFollow(avatar, true, 0.15, 0.15)
      this.lastSent = { x: player.x, y: player.y, dir: 'down', moving: false, at: 0 }
      // Rejoining a room I was sitting in: come back into the chair.
      this.applyMySeat(player)
    }
    return avatar
  }

  private removeAvatar(sessionId: string) {
    // The robots go with their player, whether they left, dropped or the room
    // was replaced: nothing else holds a reference to them.
    this.mascots.get(sessionId)?.destroy()
    this.mascots.delete(sessionId)
    const avatar = this.avatars.get(sessionId)
    if (!avatar) return
    if (avatar === this.me) {
      // When the scene shuts down (travel to another world) the camera
      // manager is already gone: stopping the follow is unnecessary and would
      // break the shutdown.
      this.cameras?.main?.stopFollow()
      this.me = undefined
    }
    avatar.destroy(true)
    this.avatars.delete(sessionId)
  }
}
