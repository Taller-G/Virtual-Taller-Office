import Phaser from 'phaser'
import type { Bubble } from '@vto/shared'

/** Colours of the area: mine highlighted, the others barely visible. */
const MINE = { fill: 0x1b6ef3, fillAlpha: 0.16, line: 0x6ea8ff, lineAlpha: 0.9 }
const OTHER = { fill: 0x9aa3b5, fillAlpha: 0.06, line: 0x9aa3b5, lineAlpha: 0.35 }
/** Smoothing of the centre, the same as the avatars' (ms). */
const LERP_TAU_MS = 80
/** Further than this, the centre snaps instead of sliding. */
const SNAP_DISTANCE = 240
/** Below the avatars' floor, so it never covers them. */
const DEPTH = -1

/**
 * Area of a conversation bubble: a circle of the radius the server sends,
 * centred on the centroid of its members. The centre slides towards the
 * latest position received with the same smoothing as the avatars, so it does
 * not jump with every patch.
 */
export class BubbleArea extends Phaser.GameObjects.Graphics {
  private target: { x: number; y: number }
  private mine = false
  private radius: number
  private label: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, bubble: Bubble, radius: number, mine: boolean) {
    super(scene, { x: bubble.x, y: bubble.y })
    this.target = { x: bubble.x, y: bubble.y }
    this.radius = radius
    this.setDepth(DEPTH)
    this.label = scene.add
      .text(bubble.x, bubble.y - radius - 2, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: '#e8ecf3',
        backgroundColor: '#1b6ef3cc',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH)
      .setVisible(false)
    scene.add.existing(this)
    this.setMine(mine)
    this.setRadius(radius)
  }

  setTarget(partial: Partial<{ x: number; y: number }>) {
    Object.assign(this.target, partial)
  }

  setRadius(radius: number) {
    if (radius > 0 && radius !== this.radius) this.radius = radius
    this.redraw()
  }

  setMine(mine: boolean) {
    if (mine === this.mine) return
    this.mine = mine
    this.redraw()
  }

  /** Text over the area: how many are in the conversation (own area only). */
  setCount(members: number) {
    this.label.setVisible(this.mine && members > 0)
    this.label.setText(members === 1 ? '1 persona' : `${members} personas`)
  }

  private redraw() {
    const style = this.mine ? MINE : OTHER
    this.clear()
    this.fillStyle(style.fill, style.fillAlpha)
    this.fillCircle(0, 0, this.radius)
    this.lineStyle(1, style.line, style.lineAlpha)
    this.strokeCircle(0, 0, this.radius)
    this.label.setY(this.y - this.radius - 2)
  }

  /** Slides the centre towards the latest position received from the server. */
  interpolate(deltaMs: number) {
    const dx = this.target.x - this.x
    const dy = this.target.y - this.y
    if (dx === 0 && dy === 0) return
    const distance = Math.hypot(dx, dy)
    if (distance > SNAP_DISTANCE || distance < 0.5) {
      this.setPosition(this.target.x, this.target.y)
    } else {
      const k = 1 - Math.exp(-deltaMs / LERP_TAU_MS)
      this.setPosition(this.x + dx * k, this.y + dy * k)
    }
    this.label.setPosition(this.x, this.y - this.radius - 2)
  }

  destroy(fromScene?: boolean) {
    this.label.destroy()
    super.destroy(fromScene)
  }
}
