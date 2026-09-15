import { MASCOT_FRAME } from '@vto/shared'
import { config } from '../config'
import { PORTRAIT_FRAME } from '../game/avatarAnims'

/**
 * Portrait of a mascot type (its idle frame facing down) as a DOM element: it
 * crops the sprite sheet with `background-position`, scaled without smoothing,
 * exactly as `avatarThumb` does for a person. The frame is the mascots' own
 * 16x24 one, so a duck in the picker is the same duck the office draws.
 */
export function mascotThumb(type: string, scale = 1): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = 'mascot-thumb'
  el.setAttribute('aria-hidden', 'true')
  el.style.width = `${MASCOT_FRAME.width * scale}px`
  el.style.height = `${MASCOT_FRAME.height * scale}px`
  el.style.backgroundImage = `url(${config.mascotsUrl}${type}.png)`
  el.style.backgroundSize = `${MASCOT_FRAME.width * MASCOT_FRAME.count * scale}px ${MASCOT_FRAME.height * scale}px`
  el.style.backgroundPosition = `-${PORTRAIT_FRAME * MASCOT_FRAME.width * scale}px 0`
  return el
}
