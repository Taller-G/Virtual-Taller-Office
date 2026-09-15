import {
  ANIM_START,
  AVATAR_FRAME,
  NO_TINT,
  allLayerSheets,
  appearanceLayers,
  type Appearance,
} from '@vto/shared'
import { config } from '../config'
import { layerSheetUrl } from '../game/avatarAnims'

/**
 * Live preview of a composed avatar for the entry screen.
 *
 * It paints the very layers `appearanceLayers()` lists, in that order and with
 * those tints, so the entry screen and the office cannot show different
 * avatars — adding a part to the catalogue makes it appear here with no change
 * to this file.
 *
 * Why a canvas rather than stacked DOM sprites: in the office the greyscale
 * hair and top sheets are coloured with Phaser's `setTint()`, which multiplies
 * the texture by the tint. No CSS filter reproduces a per-channel multiply, so
 * the only faithful way to preview it outside the game is to composite the
 * frames ourselves.
 */

/** The pose shown: standing still, facing the viewer. One frame, no animation. */
const PREVIEW_FRAME = ANIM_START.idle.down

/** How many screen pixels per sprite pixel. Integer, so the art stays sharp. */
const SCALE = 4

/**
 * Sheets already fetched, by URL. A sheet that failed to load is remembered as
 * `null` so a broken file is not requested again on every option change.
 */
const sheets = new Map<string, HTMLImageElement | null>()
/** In-flight fetches, so two layers wanting the same sheet share one request. */
const pending = new Map<string, Promise<HTMLImageElement | null>>()

/**
 * Fetches a sprite sheet once. It never rejects: a sheet that fails to load
 * resolves to `null` and its layer is simply skipped, so a missing accessory
 * costs that accessory and not the whole preview.
 */
function loadSheet(url: string): Promise<HTMLImageElement | null> {
  const done = pending.get(url)
  if (done) return done
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => {
      sheets.set(url, image)
      resolve(image)
    })
    image.addEventListener('error', () => {
      console.warn(`[avatar-preview] could not load ${url} (drawing the other layers)`)
      sheets.set(url, null)
      resolve(null)
    })
    image.src = url
  })
  pending.set(url, promise)
  return promise
}

/**
 * Cuts one frame out of a sheet and multiplies it by `tint`, the way
 * `setTint()` does in the game.
 *
 * `multiply` alone would also paint the tint over the frame's transparent
 * pixels (it composites source-over), so the original is drawn back with
 * `destination-in` to restore the frame's own silhouette.
 */
function tintedFrame(sheet: HTMLImageElement, tint: number): HTMLCanvasElement {
  const { width, height } = AVATAR_FRAME
  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  const ctx = frame.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const sx = PREVIEW_FRAME * width
  ctx.drawImage(sheet, sx, 0, width, height, 0, 0, width, height)
  if (tint !== NO_TINT) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(sheet, sx, 0, width, height, 0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
  return frame
}

export interface AvatarPreview {
  /** The element to put in the page. */
  el: HTMLElement
  /** Draws this appearance. Safe to call on every keystroke or click. */
  update(appearance: Appearance): void
}

/**
 * Creates the preview. It draws synchronously from the sheets it already has,
 * so an option change shows in the same frame, and repaints when a sheet it
 * was still waiting for arrives.
 */
export function avatarPreview(): AvatarPreview {
  const el = document.createElement('div')
  el.className = 'avatar-preview'

  const label = document.createElement('span')
  label.className = 'avatar-preview__label'
  label.textContent = 'Preview'
  el.append(label)

  const canvas = document.createElement('canvas')
  canvas.className = 'avatar-preview__canvas'
  canvas.width = AVATAR_FRAME.width * SCALE
  canvas.height = AVATAR_FRAME.height * SCALE
  // A picture of the avatar being built: the option buttons already say what
  // it is made of, so there is nothing here for a screen reader to read out.
  canvas.setAttribute('aria-hidden', 'true')
  el.append(canvas)

  const ctx = canvas.getContext('2d')!

  /** Bumped on every update, so a sheet arriving late cannot repaint a look the user has moved on from. */
  let generation = 0
  let current: Appearance | null = null

  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!current) return
    // Nearest-neighbour: pixel art scaled up has to stay hard-edged. It is set
    // on every paint because a canvas resets its context state when resized.
    ctx.imageSmoothingEnabled = false
    for (const layer of appearanceLayers(current)) {
      const sheet = sheets.get(layerSheetUrl(config.avatarsUrl, layer))
      if (!sheet) continue // not loaded yet, or missing: skip this layer only
      ctx.drawImage(tintedFrame(sheet, layer.tint), 0, 0, canvas.width, canvas.height)
    }
  }

  /**
   * Once the first look is on screen, fetch every other sheet the catalogue
   * knows about, so from then on any option change paints straight from cache.
   * It waits for the first paint on purpose: the layers being shown now must
   * not queue behind three dozen the user may never pick.
   */
  let warmed = false
  function warm() {
    if (warmed) return
    warmed = true
    for (const sheet of allLayerSheets()) void loadSheet(layerSheetUrl(config.avatarsUrl, sheet))
  }

  function update(appearance: Appearance) {
    current = appearance
    const mine = ++generation
    paint() // whatever is already cached, right now
    const missing = appearanceLayers(appearance)
      .map((layer) => layerSheetUrl(config.avatarsUrl, layer))
      .filter((url) => !sheets.has(url))
    if (missing.length === 0) {
      warm()
      return
    }
    void Promise.all(missing.map(loadSheet)).then(() => {
      if (mine === generation) paint()
      warm()
    })
  }

  return { el, update }
}
