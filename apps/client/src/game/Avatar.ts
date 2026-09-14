import Phaser from 'phaser'
import {
  AVATAR_FRAME,
  HAIR_COLORS,
  TOP_COLORS,
  parseAppearance,
  type Appearance,
  type Direction,
} from '@vto/shared'
import {
  animKey,
  layerAnimKey,
  layerTextureKey,
  resolveLoadedAvatar,
  textureKey,
  type AnimState,
} from './avatarAnims'

/**
 * Physics body of the avatar: the "feet", smaller than the sprite so it fits
 * through one-tile doorways. The container's origin is the top centre of the
 * body; the body occupies `[y, y + BODY.height]`.
 */
export const BODY = { width: 18, height: 12, offsetY: 6 } as const

/** Time constant of the smoothing of the other avatars (ms). */
const LERP_TAU_MS = 80
/** If the target is further away than this, it snaps straight there (teleport, spawn). */
const SNAP_DISTANCE = 160
/** If more than this passed between frames (hidden tab), it snaps to the target. */
const SNAP_AFTER_MS = 500

/** Speech balloon: how long it stays on screen and how much text fits. */
const SAY = {
  baseMs: 2_500,
  perCharMs: 45,
  maxMs: 8_000,
  width: 108,
  maxChars: 90,
} as const

export interface AvatarOptions {
  avatar: string
  appearance: string
  name: string
  isMe: boolean
}

/**
 * A player on screen.
 *
 * Two rendering modes:
 * - **Preset** (empty `appearance`): a single `Phaser.Sprite` with the full
 *   sheet of the selected avatar, as before.
 * - **Composed** (`appearance` with valid `Appearance` JSON): several layers
 *   (body, top, hair, glasses, hat) stacked in the container. The hair and
 *   top layers are tinted with `setTint()` over their greyscale sheet; the
 *   body one uses a sheet pre-generated per skin tone.
 *
 * In both modes the container also carries: name, "away" badge, bubble ring
 * and chat balloon.
 */
export class Avatar extends Phaser.GameObjects.Container {
  readonly isMe: boolean

  // --- sprite(s) -----------------------------------------------------------
  /** Single sprite of the preset (null when composed). */
  private presetSprite: Phaser.GameObjects.Sprite | null = null
  /** Layers of the composed avatar (empty when a preset). */
  private layers: Phaser.GameObjects.Sprite[] = []
  /** Current texture keys of each layer (for playAnim). */
  private layerTexKeys: string[] = []

  /** Public reference to the main sprite (or the first layer). */
  get sprite(): Phaser.GameObjects.Sprite {
    return this.presetSprite ?? this.layers[0]
  }

  // --- decorations ---------------------------------------------------------
  private label: Phaser.GameObjects.Text
  private badge: Phaser.GameObjects.Text
  private ring: Phaser.GameObjects.Graphics
  private balloon: Phaser.GameObjects.Text
  private balloonTimer?: Phaser.Time.TimerEvent

  // --- state ---------------------------------------------------------------
  avatarId: string
  private currentAppearance: Appearance | null = null
  dir: Direction = 'down'
  moving = false
  away = false
  connected = true
  target: { x: number; y: number }

  constructor(scene: Phaser.Scene, x: number, y: number, options: AvatarOptions) {
    super(scene, x, y)
    this.isMe = options.isMe
    this.avatarId = resolveLoadedAvatar(scene.textures, options.avatar)
    this.target = { x, y }

    const feetY = BODY.height

    // Ring (behind everything)
    this.ring = scene.add.graphics()
    this.ring.fillStyle(0x1b6ef3, 0.28)
    this.ring.fillEllipse(0, feetY - 2, BODY.width + 6, 8)
    this.ring.lineStyle(1, 0x6ea8ff, 0.9)
    this.ring.strokeEllipse(0, feetY - 2, BODY.width + 6, 8)
    this.ring.setVisible(false)

    // Label
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

    // Badge "ausente"
    this.badge = scene.add
      .text(0, this.label.y - this.label.height - 1, 'away', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '6px',
        color: '#1b1f2a',
        backgroundColor: '#f5c451',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setVisible(false)

    // Balloon
    this.balloon = scene.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: '#1b1f2a',
        backgroundColor: '#f7f9fc',
        align: 'center',
        padding: { x: 3, y: 2 },
        wordWrap: { width: SAY.width },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setVisible(false)

    // Build the avatar sprite(s) and assemble the container children.
    this.buildVisual(options.appearance)

    this.setSize(BODY.width, BODY.height)
    this.updateDepth()
    this.playAnim('idle', 'down')
    scene.add.existing(this)
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.balloonTimer?.remove())
  }

  // -------------------------------------------------------------------------
  // Visual construction
  // -------------------------------------------------------------------------

  /**
   * Builds (or rebuilds) the visual representation — either a single preset
   * sprite or layered composable sprites — and reassembles the container's
   * child list in the correct draw order.
   */
  private buildVisual(appearanceStr: string) {
    // Destroy previous sprites
    this.presetSprite?.destroy()
    this.presetSprite = null
    for (const s of this.layers) s.destroy()
    this.layers = []
    this.layerTexKeys = []

    const feetY = BODY.height
    const parsed = parseAppearance(appearanceStr)

    if (parsed) {
      this.currentAppearance = parsed
      this.buildLayers(parsed, feetY)
    } else {
      this.currentAppearance = null
      this.presetSprite = this.scene.add
        .sprite(0, feetY, textureKey(this.avatarId))
        .setOrigin(0.5, 1)
    }

    // Reassemble container children in draw order:
    // ring → sprites → label → badge → balloon
    const children: Phaser.GameObjects.GameObject[] = [this.ring]
    if (this.presetSprite) {
      children.push(this.presetSprite)
    } else {
      children.push(...this.layers)
    }
    children.push(this.label, this.badge, this.balloon)
    this.removeAll(false) // remove without destroying
    this.add(children)
  }

  /** Creates the layered sprites for a composed appearance. */
  private buildLayers(a: Appearance, feetY: number) {
    const addLayer = (texKey: string, tint?: number) => {
      if (!this.scene.textures.exists(texKey)) return
      const sprite = this.scene.add.sprite(0, feetY, texKey).setOrigin(0.5, 1)
      if (tint !== undefined && tint !== 0xffffff) sprite.setTint(tint)
      this.layers.push(sprite)
      this.layerTexKeys.push(texKey)
    }

    // Order: body → top → hair → glasses → hat
    addLayer(layerTextureKey(a.base, 'body', a.skinTone))
    addLayer(layerTextureKey(a.base, 'top'), TOP_COLORS[a.topColor])
    addLayer(layerTextureKey(a.base, 'hair'), HAIR_COLORS[a.hairColor])
    if (a.glasses !== 'none') addLayer(layerTextureKey('acc', a.glasses))
    if (a.hat !== 'none') addLayer(layerTextureKey('acc', a.hat))
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  say(text: string) {
    const shown = text.length > SAY.maxChars ? `${text.slice(0, SAY.maxChars)}…` : text
    this.balloon.setText(shown)
    const top = this.badge.visible
      ? this.badge.y - this.badge.height
      : this.label.y - this.label.height
    this.balloon.setY(top - 2)
    this.balloon.setVisible(true)
    this.balloonTimer?.remove()
    this.balloonTimer = this.scene.time.delayedCall(
      Math.min(SAY.maxMs, SAY.baseMs + shown.length * SAY.perCharMs),
      () => this.balloon.setVisible(false),
    )
  }

  setLabel(name: string) {
    this.label.setText(name)
    this.badge.setY(this.label.y - this.label.height - 1)
  }

  setAvatar(avatar: string) {
    if (this.currentAppearance) return // composed mode ignores avatar changes
    const resolved = resolveLoadedAvatar(this.scene.textures, avatar)
    if (resolved === this.avatarId) return
    this.avatarId = resolved
    this.presetSprite?.setTexture(textureKey(resolved))
    this.playAnim(this.moving ? 'walk' : 'idle', this.dir, true)
  }

  setAppearance(appearanceStr: string) {
    const parsed = parseAppearance(appearanceStr)
    if (
      JSON.stringify(parsed) === JSON.stringify(this.currentAppearance) ||
      (!parsed && !this.currentAppearance)
    ) {
      return
    }
    this.buildVisual(appearanceStr)
    this.playAnim(this.moving ? 'walk' : 'idle', this.dir, true)
  }

  setAway(away: boolean) {
    this.away = away
    this.badge.setVisible(away)
    this.refreshAlpha()
  }

  setInBubble(inMyBubble: boolean) {
    this.ring.setVisible(inMyBubble)
  }

  setConnected(connected: boolean) {
    this.connected = connected
    this.refreshAlpha()
  }

  private refreshAlpha() {
    this.setAlpha(!this.connected ? 0.35 : this.away ? 0.6 : 1)
  }

  /** Changes the animation only if it differs from the current one (avoids restarting it every frame). */
  playAnim(state: AnimState, dir: Direction, force = false) {
    this.dir = dir
    this.moving = state === 'walk'

    if (this.presetSprite) {
      // Preset mode: single sprite
      const key = animKey(this.avatarId, state, dir)
      if (force || this.presetSprite.anims.currentAnim?.key !== key) {
        this.presetSprite.play(key, true)
      }
    } else {
      // Composed mode: all layers play in sync
      for (let i = 0; i < this.layers.length; i++) {
        const sprite = this.layers[i]
        const key = layerAnimKey(this.layerTexKeys[i], state, dir)
        if (force || sprite.anims.currentAnim?.key !== key) {
          sprite.play(key, true)
        }
      }
    }
  }

  /** Depth = bottom edge of the feet, like the map's furniture. */
  updateDepth() {
    this.setDepth(this.y + BODY.height)
  }

  setTarget(partial: Partial<{ x: number; y: number }>) {
    Object.assign(this.target, partial)
  }

  snapToTarget() {
    this.setPosition(this.target.x, this.target.y)
    this.updateDepth()
  }

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
