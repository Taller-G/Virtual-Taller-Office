import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import type { Player } from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'

export const SCENE_SIZE = { width: 800, height: 600 } as const
const TILE = 40
const AVATAR_RADIUS = 16

/** Paleta estable por jugador, derivada de su sessionId. */
function colorFor(sessionId: string): number {
  let hash = 0
  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.55).color
}

/**
 * Escena única: dibuja un avatar por jugador presente en el estado de la sala
 * y lo quita cuando el servidor lo elimina. Todavía no hay movimiento: es la
 * base sobre la que se construyen presencia, burbujas y chat.
 */
export class OfficeScene extends Phaser.Scene {
  private avatars = new Map<string, Phaser.GameObjects.Container>()
  private unbindRoom: Array<() => void> = []
  private offRoom?: () => void

  constructor(private connection: OfficeConnection) {
    super('office')
  }

  create() {
    this.drawFloor()
    this.offRoom = this.connection.on('room', (room) => this.bindRoom(room))
    if (this.connection.room) this.bindRoom(this.connection.room)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offRoom?.()
      this.clearRoom()
    })
  }

  private drawFloor() {
    const g = this.add.graphics()
    g.fillStyle(0x222838, 1)
    g.fillRect(0, 0, SCENE_SIZE.width, SCENE_SIZE.height)
    g.lineStyle(1, 0x2f3749, 1)
    for (let x = 0; x <= SCENE_SIZE.width; x += TILE) g.lineBetween(x, 0, x, SCENE_SIZE.height)
    for (let y = 0; y <= SCENE_SIZE.height; y += TILE) g.lineBetween(0, y, SCENE_SIZE.width, y)
  }

  /** Una sala nueva reemplaza por completo lo que había (reingreso incluido). */
  private bindRoom(room: OfficeRoom) {
    this.clearRoom()
    const $ = Callbacks.get(room)

    this.unbindRoom.push(
      $.onAdd('players', (player, sessionId) => {
        this.addAvatar(player, sessionId, sessionId === room.sessionId)
        this.unbindRoom.push(
          $.listen(player, 'x', (x) => this.avatars.get(sessionId)?.setX(x)),
          $.listen(player, 'y', (y) => this.avatars.get(sessionId)?.setY(y)),
          $.listen(player, 'connected', (connected) => {
            this.avatars.get(sessionId)?.setAlpha(connected ? 1 : 0.35)
          }),
          $.listen(player, 'name', (name) => this.setLabel(sessionId, name)),
        )
      }),
      $.onRemove('players', (_player, sessionId) => this.removeAvatar(sessionId)),
    )
  }

  private clearRoom() {
    for (const unbind of this.unbindRoom.splice(0)) unbind()
    for (const sessionId of [...this.avatars.keys()]) this.removeAvatar(sessionId)
  }

  private addAvatar(player: Player, sessionId: string, isMe: boolean) {
    this.removeAvatar(sessionId)
    const body = this.add.circle(0, 0, AVATAR_RADIUS, colorFor(sessionId))
    body.setStrokeStyle(isMe ? 3 : 1.5, isMe ? 0xffffff : 0x000000, 0.9)
    const label = this.add
      .text(0, AVATAR_RADIUS + 6, player.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#e8ecf3',
        backgroundColor: '#0008',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 0)
      .setName('label')
    const container = this.add.container(player.x, player.y, [body, label])
    container.setAlpha(player.connected ? 1 : 0.35)
    container.setDepth(isMe ? 2 : 1)
    this.avatars.set(sessionId, container)
  }

  private setLabel(sessionId: string, name: string) {
    const label = this.avatars.get(sessionId)?.getByName('label')
    if (label instanceof Phaser.GameObjects.Text) label.setText(name)
  }

  private removeAvatar(sessionId: string) {
    this.avatars.get(sessionId)?.destroy(true)
    this.avatars.delete(sessionId)
  }
}
