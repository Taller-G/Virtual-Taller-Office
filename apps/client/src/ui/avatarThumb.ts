import { AVATAR_FRAME } from '@vto/shared'
import { config } from '../config'
import { PORTRAIT_FRAME } from '../game/avatarAnims'

/**
 * Retrato de un avatar (frame quieto mirando abajo) como elemento DOM: recorta
 * la hoja de sprites con `background-position`, escalado sin suavizado.
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
