import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import {
  DEFAULT_WORLD_ID,
  doorAtRect,
  getWorld,
  Message,
  worldName,
  type Direction,
  type Door,
  type MovePayload,
  type Player,
} from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { toast } from '../ui/toasts'
import { Avatar, BODY } from './Avatar'
import { createAvatarAnims } from './avatarAnims'
import { BubbleArea } from './BubbleArea'
import { buildOfficeMap, drawCollisionDebug, type BuiltMap } from './officeMap'
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
  }

  create() {
    this.map = buildOfficeMap(this, this.worldId)
    this.cameras.main.fadeIn(FADE_MS)
    if (this.debug) drawCollisionDebug(this, this.map)
    createAvatarAnims(this)

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
    }

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
      this.clearRoom()
    })
  }

  update(time: number, delta: number) {
    if (this.me) this.moveMe(time)
    this.checkDoors()
    for (const avatar of this.avatars.values()) {
      if (!avatar.isMe) avatar.interpolate(delta)
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
          $.listen(player, 'bubbleId', () => this.refreshBubbles()),
        )
        // This client sends its own position and animation: they are not overwritten by the echo.
        if (!isMe) {
          this.unbindRoom.push(
            $.listen(player, 'x', (x) => avatar.setTarget({ x })),
            $.listen(player, 'y', (y) => avatar.setTarget({ y })),
            $.listen(player, 'dir', () => this.syncAnim(avatar, player)),
            $.listen(player, 'moving', () => this.syncAnim(avatar, player)),
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
    avatar.playAnim(player.moving ? 'walk' : 'idle', dir)
  }

  private clearRoom() {
    for (const unbind of this.unbindRoom.splice(0)) unbind()
    for (const sessionId of [...this.avatars.keys()]) this.removeAvatar(sessionId)
    for (const area of this.bubbleAreas.values()) area.destroy(true)
    this.bubbleAreas.clear()
    this.room = undefined
    this.me = undefined
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
    }
    return avatar
  }

  private removeAvatar(sessionId: string) {
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
