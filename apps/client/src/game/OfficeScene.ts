import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import { Message, type Direction, type MovePayload, type Player } from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { Avatar, BODY } from './Avatar'
import { createAvatarAnims } from './avatarAnims'
import { buildOfficeMap, drawCollisionDebug, type BuiltMap } from './officeMap'
import { isTyping } from './typingGuard'

/** Velocidad de caminata, px/s. */
const SPEED = 150
/** Zoom de la cámara: entero para que el pixel art no se vea borroso. */
const CAMERA_ZOOM = 2
/** Cada cuánto, como máximo, se manda la posición propia al servidor (20 veces/s). */
const SEND_INTERVAL_MS = 50

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
 * Escena de la oficina: dibuja el mapa Tiled con sus colisiones y un avatar
 * por jugador presente en el estado de la sala. El propio se mueve con
 * flechas / WASD (física Arcade contra paredes y muebles) y manda posición y
 * animación al servidor a lo sumo 20 veces por segundo, solo cuando cambian.
 * Los demás se deslizan hacia la última posición recibida.
 *
 * La lista de avatares refleja `state.players` tal cual: se crean en
 * `onAdd` y se destruyen en `onRemove`; nada más los agrega o los retiene.
 */
export class OfficeScene extends Phaser.Scene {
  private map!: BuiltMap
  private avatars = new Map<string, Avatar>()
  private me?: Avatar
  private keys!: Keys
  private room?: OfficeRoom
  private unbindRoom: Array<() => void> = []
  private offRoom?: () => void
  private lastSent: Sent = { x: NaN, y: NaN, dir: 'down', moving: false, at: 0 }
  private debug: boolean

  constructor(
    private connection: OfficeConnection,
    options: { debug?: boolean } = {},
  ) {
    super('office')
    this.debug = options.debug ?? false
  }

  create() {
    this.map = buildOfficeMap(this)
    if (this.debug) drawCollisionDebug(this, this.map)
    createAvatarAnims(this.anims)

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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offRoom?.()
      this.clearRoom()
    })
  }

  update(time: number, delta: number) {
    if (this.me) this.moveMe(time)
    for (const avatar of this.avatars.values()) {
      if (!avatar.isMe) avatar.interpolate(delta)
    }
  }

  private moveMe(time: number) {
    const me = this.me!
    const body = me.body as Phaser.Physics.Arcade.Body
    // Con el foco en un campo de texto las teclas no mueven al avatar.
    const typing = isTyping()
    const down = (keys: Phaser.Input.Keyboard.Key[]) => !typing && keys.some((k) => k.isDown)
    const dx = (down(this.keys.right) ? 1 : 0) - (down(this.keys.left) ? 1 : 0)
    const dy = (down(this.keys.down) ? 1 : 0) - (down(this.keys.up) ? 1 : 0)

    if (dx || dy) {
      const length = Math.hypot(dx, dy)
      body.setVelocity((dx / length) * SPEED, (dy / length) * SPEED)
      // En diagonal gana el eje horizontal para elegir la dirección del sprite.
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

  /** Una sala nueva reemplaza por completo lo que había (reingreso incluido). */
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
        )
        // La posición y animación propias las manda este cliente: no se pisan con el eco.
        if (!isMe) {
          this.unbindRoom.push(
            $.listen(player, 'x', (x) => avatar.setTarget({ x })),
            $.listen(player, 'y', (y) => avatar.setTarget({ y })),
            $.listen(player, 'dir', () => this.syncAnim(avatar, player)),
            $.listen(player, 'moving', () => this.syncAnim(avatar, player)),
          )
        }
      }),
      $.onRemove('players', (_player, sessionId) => this.removeAvatar(sessionId)),
    )
  }

  private syncAnim(avatar: Avatar, player: Player) {
    const dir = player.dir as Direction
    avatar.playAnim(player.moving ? 'walk' : 'idle', dir)
  }

  private clearRoom() {
    for (const unbind of this.unbindRoom.splice(0)) unbind()
    for (const sessionId of [...this.avatars.keys()]) this.removeAvatar(sessionId)
    this.room = undefined
    this.me = undefined
  }

  private addAvatar(player: Player, sessionId: string, isMe: boolean): Avatar {
    this.removeAvatar(sessionId)
    const avatar = new Avatar(this, player.x, player.y, {
      avatar: player.avatar,
      name: player.name,
      isMe,
    })
    avatar.setConnected(player.connected)
    avatar.setAway(player.away)
    this.syncAnim(avatar, player)
    this.avatars.set(sessionId, avatar)

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
      this.cameras.main.stopFollow()
      this.me = undefined
    }
    avatar.destroy(true)
    this.avatars.delete(sessionId)
  }
}
