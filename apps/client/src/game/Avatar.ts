import Phaser from 'phaser'
import { AVATAR_FRAME, type Direction } from '@vto/shared'
import { animKey, textureKey, type AnimState } from './avatarAnims'

/**
 * Cuerpo físico del avatar: los "pies", más chico que el sprite para pasar
 * por puertas de un tile. El origen del contenedor es el centro superior del
 * cuerpo; el cuerpo ocupa `[y, y + BODY.height]`.
 */
export const BODY = { width: 18, height: 12, offsetY: 6 } as const

/** Constante de tiempo del suavizado de los otros avatares (ms). */
const LERP_TAU_MS = 80
/** Si el objetivo está más lejos que esto, se salta directo (teletransporte, spawn). */
const SNAP_DISTANCE = 160
/** Si pasó más que esto entre frames (pestaña oculta), se salta al objetivo. */
const SNAP_AFTER_MS = 500

export interface AvatarOptions {
  avatar: string
  name: string
  isMe: boolean
}

/**
 * Un jugador en pantalla: sprite animado, nombre encima y estado (ausente /
 * desconectado). Para los demás jugadores mantiene una posición objetivo y se
 * desliza hacia ella en `interpolate()`; el propio se mueve por física.
 */
export class Avatar extends Phaser.GameObjects.Container {
  readonly isMe: boolean
  readonly sprite: Phaser.GameObjects.Sprite
  private label: Phaser.GameObjects.Text
  private badge: Phaser.GameObjects.Text
  avatarId: string
  dir: Direction = 'down'
  moving = false
  away = false
  connected = true
  /** Última posición recibida del servidor (solo otros jugadores). */
  target: { x: number; y: number }

  constructor(scene: Phaser.Scene, x: number, y: number, options: AvatarOptions) {
    super(scene, x, y)
    this.isMe = options.isMe
    this.avatarId = options.avatar
    this.target = { x, y }

    const feetY = BODY.height
    this.sprite = scene.add.sprite(0, feetY, textureKey(options.avatar)).setOrigin(0.5, 1)
    this.label = scene.add
      .text(0, feetY - AVATAR_FRAME.height - 1, options.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: options.isMe ? '#ffffff' : '#e8ecf3',
        backgroundColor: options.isMe ? '#1b6ef3cc' : '#000000aa',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
    this.badge = scene.add
      .text(0, this.label.y - this.label.height - 1, 'ausente', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '6px',
        color: '#1b1f2a',
        backgroundColor: '#f5c451',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setVisible(false)

    this.add([this.sprite, this.label, this.badge])
    this.setSize(BODY.width, BODY.height)
    this.updateDepth()
    this.playAnim('idle', 'down')
    scene.add.existing(this)
  }

  setLabel(name: string) {
    this.label.setText(name)
    this.badge.setY(this.label.y - this.label.height - 1)
  }

  setAvatar(avatar: string) {
    if (avatar === this.avatarId) return
    this.avatarId = avatar
    this.sprite.setTexture(textureKey(avatar))
    this.playAnim(this.moving ? 'walk' : 'idle', this.dir, true)
  }

  setAway(away: boolean) {
    this.away = away
    this.badge.setVisible(away)
    this.refreshAlpha()
  }

  setConnected(connected: boolean) {
    this.connected = connected
    this.refreshAlpha()
  }

  private refreshAlpha() {
    this.setAlpha(!this.connected ? 0.35 : this.away ? 0.6 : 1)
  }

  /** Cambia la animación solo si difiere de la actual (evita reiniciarla cada frame). */
  playAnim(state: AnimState, dir: Direction, force = false) {
    this.dir = dir
    this.moving = state === 'walk'
    const key = animKey(this.avatarId, state, dir)
    if (force || this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true)
  }

  /** Profundidad = borde inferior de los pies, como los muebles del mapa. */
  updateDepth() {
    this.setDepth(this.y + BODY.height)
  }

  /** Nueva posición recibida del servidor (otros jugadores). */
  setTarget(partial: Partial<{ x: number; y: number }>) {
    Object.assign(this.target, partial)
  }

  snapToTarget() {
    this.setPosition(this.target.x, this.target.y)
    this.updateDepth()
  }

  /**
   * Desliza el avatar hacia `target` con suavizado exponencial independiente
   * del framerate: en cada frame recorre `1 - e^(-dt/τ)` de la distancia que
   * falta. Con τ = 80 ms y actualizaciones cada ~50 ms el movimiento se ve
   * continuo, sin saltos ni frenadas entre paquetes.
   */
  interpolate(deltaMs: number) {
    const dx = this.target.x - this.x
    const dy = this.target.y - this.y
    if (dx === 0 && dy === 0) return
    const distance = Math.hypot(dx, dy)
    if (distance > SNAP_DISTANCE || deltaMs > SNAP_AFTER_MS || distance < 0.5) {
      this.snapToTarget()
      return
    }
    const k = 1 - Math.exp(-deltaMs / LERP_TAU_MS)
    this.setPosition(this.x + dx * k, this.y + dy * k)
    this.updateDepth()
  }
}
