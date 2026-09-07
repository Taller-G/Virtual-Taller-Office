import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import { Message, type MovePayload, type Player } from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { buildOfficeMap, drawCollisionDebug, type BuiltMap } from './officeMap'

const AVATAR_RADIUS = 12
/** Cuerpo físico del avatar: los "pies", más chico que el círculo para pasar por puertas de un tile. */
const BODY = { width: 18, height: 12, offsetY: 6 }
/** Velocidad de caminata, px/s. */
const SPEED = 150
/** Zoom de la cámara: entero para que el pixel art no se vea borroso. */
const CAMERA_ZOOM = 2
/** Cada cuánto, como máximo, se manda la posición propia al servidor. */
const SEND_INTERVAL_MS = 50
/** Factor de interpolación de los otros avatares hacia su última posición conocida. */
const LERP = 0.25

/** Paleta estable por jugador, derivada de su sessionId. */
function colorFor(sessionId: string): number {
  let hash = 0
  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.55).color
}

interface Avatar {
  container: Phaser.GameObjects.Container
  /** Posición objetivo (otros jugadores): se interpola hacia ella en `update`. */
  target: { x: number; y: number }
}

interface Keys {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
}

/**
 * Escena de la oficina: dibuja el mapa Tiled con sus colisiones, un avatar por
 * jugador presente en la sala y mueve el propio con flechas / WASD. La cámara
 * sigue al jugador. Las posiciones se sincronizan vía el estado de la sala.
 */
export class OfficeScene extends Phaser.Scene {
  private map!: BuiltMap
  private avatars = new Map<string, Avatar>()
  private me?: Avatar
  private keys!: Keys
  private room?: OfficeRoom
  private unbindRoom: Array<() => void> = []
  private offRoom?: () => void
  private lastSent = { x: NaN, y: NaN, at: 0 }
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

  update(time: number) {
    if (this.me) this.moveMe(time)
    for (const avatar of this.avatars.values()) {
      if (avatar === this.me) continue
      const { container, target } = avatar
      container.x += (target.x - container.x) * LERP
      container.y += (target.y - container.y) * LERP
      container.setDepth(container.y)
    }
  }

  private moveMe(time: number) {
    const { container } = this.me!
    const body = container.body as Phaser.Physics.Arcade.Body
    const down = (keys: Phaser.Input.Keyboard.Key[]) => keys.some((k) => k.isDown)
    const dx = (down(this.keys.right) ? 1 : 0) - (down(this.keys.left) ? 1 : 0)
    const dy = (down(this.keys.down) ? 1 : 0) - (down(this.keys.up) ? 1 : 0)
    if (dx || dy) {
      const length = Math.hypot(dx, dy)
      body.setVelocity((dx / length) * SPEED, (dy / length) * SPEED)
    } else {
      body.setVelocity(0, 0)
    }
    container.setDepth(container.y)

    if (!this.room || time - this.lastSent.at < SEND_INTERVAL_MS) return
    const x = Math.round(container.x)
    const y = Math.round(container.y)
    if (x === this.lastSent.x && y === this.lastSent.y) return
    this.lastSent = { x, y, at: time }
    const payload: MovePayload = { x, y }
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
        this.addAvatar(player, sessionId, isMe)
        this.unbindRoom.push(
          $.listen(player, 'connected', (connected) => {
            this.avatars.get(sessionId)?.container.setAlpha(connected ? 1 : 0.35)
          }),
          $.listen(player, 'name', (name) => this.setLabel(sessionId, name)),
        )
        // La posición propia la manda este cliente: no se pisa con el eco del servidor.
        if (!isMe) {
          this.unbindRoom.push(
            $.listen(player, 'x', (x) => this.setTarget(sessionId, { x })),
            $.listen(player, 'y', (y) => this.setTarget(sessionId, { y })),
          )
        }
      }),
      $.onRemove('players', (_player, sessionId) => this.removeAvatar(sessionId)),
    )
  }

  private clearRoom() {
    for (const unbind of this.unbindRoom.splice(0)) unbind()
    for (const sessionId of [...this.avatars.keys()]) this.removeAvatar(sessionId)
    this.room = undefined
    this.me = undefined
  }

  private addAvatar(player: Player, sessionId: string, isMe: boolean) {
    this.removeAvatar(sessionId)
    const body = this.add.circle(0, 0, AVATAR_RADIUS, colorFor(sessionId))
    body.setStrokeStyle(isMe ? 2 : 1, isMe ? 0xffffff : 0x000000, 0.9)
    const label = this.add
      .text(0, AVATAR_RADIUS + 3, player.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: '#e8ecf3',
        backgroundColor: '#0009',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 0)
      .setName('label')
    const container = this.add.container(player.x, player.y, [body, label])
    container.setAlpha(player.connected ? 1 : 0.35)
    container.setDepth(player.y)
    container.setSize(BODY.width, BODY.height)

    const avatar: Avatar = { container, target: { x: player.x, y: player.y } }
    this.avatars.set(sessionId, avatar)

    if (isMe) {
      this.me = avatar
      this.physics.add.existing(container)
      const physicsBody = container.body as Phaser.Physics.Arcade.Body
      physicsBody.setOffset(0, BODY.offsetY)
      physicsBody.setCollideWorldBounds(true)
      this.physics.add.collider(container, this.map.collisionLayers)
      this.physics.add.collider(container, this.map.solids)
      this.cameras.main.startFollow(container, true, 0.15, 0.15)
      this.lastSent = { x: player.x, y: player.y, at: 0 }
    }
  }

  private setTarget(sessionId: string, partial: Partial<{ x: number; y: number }>) {
    const avatar = this.avatars.get(sessionId)
    if (avatar && avatar !== this.me) Object.assign(avatar.target, partial)
  }

  private setLabel(sessionId: string, name: string) {
    const label = this.avatars.get(sessionId)?.container.getByName('label')
    if (label instanceof Phaser.GameObjects.Text) label.setText(name)
  }

  private removeAvatar(sessionId: string) {
    const avatar = this.avatars.get(sessionId)
    if (!avatar) return
    if (avatar === this.me) {
      this.cameras.main.stopFollow()
      this.me = undefined
    }
    avatar.container.destroy(true)
    this.avatars.delete(sessionId)
  }
}
