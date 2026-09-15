import Phaser from 'phaser'
import {
  AVATAR_FRAME,
  NO_TINT,
  PLAYER_BODY,
  SIT_FRAME,
  appearanceLayers,
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
 *
 * The size comes from `@vto/shared` because the server answers the same
 * question about seats ("is this player still in that chair?") and the two
 * have to agree. `offsetY` is how the sprite is hung off it, which only the
 * client cares about.
 */
export const BODY = { ...PLAYER_BODY, offsetY: 6 } as const

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
  /** Sitting at a focus desk: the sprite holds a still seated frame. */
  seated = false
  /**
   * Depth to draw at while seated, instead of the one the feet give. A chair
   * is a tile object anchored to the bottom of the seat's own tile, so it
   * would come out just above the avatar and hide whoever sat in it; the
   * scene passes the seat's bottom edge so the sitter lands in the chair
   * rather than behind it.
   */
  private seatDepth?: number
  target: { x: number; y: number }

  constructor(scene: Phaser.Scene, x: number, y: number, options: AvatarOptions) {
    super(scene, x, y)
    this.isMe = options.isMe
    this.avatarId = resolveLoadedAvatar(scene.textures, options.avatar)
    this.target = { x, y }

    const feetY = BODY.height

    // Ring (behind everything)
    this.ring = scene.add.graphics()
    this.ring.fillStyle(0x5b5bd6, 0.3)
    this.ring.fillEllipse(0, feetY - 2, BODY.width + 6, 8)
    this.ring.lineStyle(1, 0xa5a6f6, 0.9)
    this.ring.strokeEllipse(0, feetY - 2, BODY.width + 6, 8)
    this.ring.setVisible(false)

    // Label
    this.label = scene.add
      .text(0, feetY - AVATAR_FRAME.height - 1, options.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: options.isMe ? '#ffffff' : '#f4f4f5',
        backgroundColor: options.isMe ? '#5b5bd6e0' : '#0b0b0ec4',
        padding: { x: 2, y: 1 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)

    // Badge "ausente"
    this.badge = scene.add
      .text(0, this.label.y - this.label.height - 1, 'away', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '6px',
        color: '#0b0b0e',
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
        color: '#0b0b0e',
        backgroundColor: '#f4f4f5',
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

  /**
   * Creates the layered sprites for a composed appearance.
   *
   * Which layers there are, in what order and with which tint comes from
   * `appearanceLayers()` in the catalogue — the same list the entry screen's
   * preview paints, so what someone builds there is what the office shows.
   * A layer whose sheet failed to load is skipped: the rest of the avatar
   * still appears.
   */
  private buildLayers(a: Appearance, feetY: number) {
    for (const layer of appearanceLayers(a)) {
      const texKey = layerTextureKey(layer.group, layer.part, layer.variant)
      if (!this.scene.textures.exists(texKey)) continue
      const sprite = this.scene.add.sprite(0, feetY, texKey).setOrigin(0.5, 1)
      if (layer.tint !== NO_TINT) sprite.setTint(layer.tint)
      this.layers.push(sprite)
      this.layerTexKeys.push(texKey)
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * A wave over the head: it rises and fades, and unlike `say` it does not
   * take the balloon, so a wave can land on somebody who is mid-sentence
   * without cutting them off.
   *
   * It is a `Text` created for the occasion and destroyed with the tween
   * rather than a member of the container: waves are rare, and one that
   * outlives its avatar (whoever waved walked out of the world) would have to
   * be cleaned up in the avatar's teardown too.
   */
  emote(glyph = '\u{1F44B}') {
    const top = this.badge.visible
      ? this.badge.y - this.badge.height
      : this.label.y - this.label.height
    const text = this.scene.add
      .text(this.x, this.y + top - 2, glyph, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setDepth(this.depth + 1)
    this.scene.tweens.add({
      targets: text,
      y: text.y - 14,
      alpha: { from: 1, to: 0 },
      ease: 'Quad.easeOut',
      duration: 1100,
      onComplete: () => text.destroy(),
    })
  }

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
    this.applyPose(true)
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
    this.applyPose(true)
  }

  setAway(away: boolean) {
    this.away = away
    this.refreshBadge()
    this.refreshAlpha()
  }

  /**
   * Sitting down or standing up. Seated is a **still frame**, not an
   * animation: the sheets have exactly one seated frame per direction. It is
   * applied to the preset sprite or to every layer of a composed avatar
   * alike, so everyone in the room sees the same pose.
   */
  setSeated(seated: boolean, dir: Direction = this.dir, depth?: number) {
    const unchanged = this.seated === seated && this.dir === dir && this.seatDepth === depth
    this.seatDepth = seated ? depth : undefined
    this.updateDepth()
    if (unchanged) return
    this.seated = seated
    this.dir = dir
    if (seated) this.moving = false
    this.applyPose(true)
    this.refreshBadge()
  }

  /**
   * Puts the current pose on the sprites: the seated still frame, or the
   * walk/idle animation. It is what has to run again whenever the sprites are
   * rebuilt (a change of avatar or of appearance), since new sprites start on
   * frame 0 and would otherwise stand up on their own.
   */
  private applyPose(force = false) {
    if (this.seated) {
      for (const sprite of this.sprites()) {
        sprite.anims.stop()
        sprite.setFrame(SIT_FRAME[this.dir])
      }
      return
    }
    this.playAnim(this.moving ? 'walk' : 'idle', this.dir, force)
  }

  /** Every sprite that makes up the avatar: the preset one, or the layers. */
  private sprites(): Phaser.GameObjects.Sprite[] {
    return this.presetSprite ? [this.presetSprite] : this.layers
  }

  /**
   * The badge over the name: "Focused" while sitting at a desk, "away"
   * otherwise. Focused wins, the same way it does in the people list — and
   * the server never lets the two hold at once anyway.
   */
  private refreshBadge() {
    const label = this.seated ? 'Focused' : this.away ? 'away' : ''
    this.badge.setVisible(label !== '')
    if (label === '') return
    this.badge.setText(label)
    this.badge.setBackgroundColor(this.seated ? '#8b5cf6' : '#f5c451')
    this.badge.setColor(this.seated ? '#f5f3ff' : '#1b1f2a')
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
    // While seated the pose is a still frame nothing else may overwrite; the
    // way out is `setSeated(false)`.
    if (this.seated) return

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

  /** Depth = bottom edge of the feet, like the map's furniture (or the seat's). */
  updateDepth() {
    this.setDepth(this.seatDepth ?? this.y + BODY.height)
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
