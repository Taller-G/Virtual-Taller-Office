import { AVATAR_FRAME } from '@vto/shared'
import { config } from '../config'
import { PORTRAIT_FRAME } from '../game/avatarAnims'

/**
 * Portrait of an avatar (idle frame facing down) as a DOM element: it crops the
 * sprite sheet with `background-position`, scaled without smoothing.
 */
export function avatarThumb(avatar: string, scale = 1): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = 'avatar-thumb'
  el.setAttribute('aria-hidden', 'true')
  el.style.width = `${AVATAR_FRAME.width * scale}px`
  el.style.height = `${AVATAR_FRAME.height * scale}px`
  el.style.backgroundImage = `url(${config.avatarsUrl}${avatar}.png)`
  el.style.backgroundSize = `${AVATAR_FRAME.width * AVATAR_FRAME.count * scale}px ${AVATAR_FRAME.height * scale}px`
  el.style.backgroundPosition = `-${PORTRAIT_FRAME * AVATAR_FRAME.width * scale}px 0`
  return el
}

/**
 * The portrait as it is shown in the side panel: framed in a rounded box with
 * a ring in the person's colour, cropped to the head and shoulders.
 *
 * The sheet's frame is a whole standing body (32x48), which at the size a list
 * row can afford is a thumbnail of a pair of legs. The box shows the top of it
 * instead, scaled to fill the width, so what one sees is a face.
 *
 * `size` is the side of the box in pixels; `color` paints the ring (and is
 * handed on to CSS as `--person` for anything else the rule wants to derive).
 */
export function avatarBadge(avatar: string, color: string, size: number): HTMLSpanElement {
  const frame = document.createElement('span')
  frame.className = 'avatar-badge'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.setProperty('--person', color)
  frame.style.width = `${size}px`
  frame.style.height = `${size}px`
  // The head sits in the top two thirds of the frame: scaling by the width and
  // letting the box clip the rest lands the face in the middle of it.
  const scale = size / AVATAR_FRAME.width
  const thumb = avatarThumb(avatar, scale)
  thumb.style.marginTop = `${-0.06 * size}px`
  frame.append(thumb)
  return frame
}
