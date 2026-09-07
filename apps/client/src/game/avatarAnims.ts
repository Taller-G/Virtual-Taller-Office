import Phaser from 'phaser'
import { ANIM_START, AVATAR_IDS, DIRECTIONS, FRAMES_PER_ANIM, type Direction } from '@vto/shared'

export type AnimState = 'idle' | 'walk'

/** Clave de textura (hoja de sprites) de un avatar en la caché de Phaser. */
export function textureKey(avatar: string): string {
  return `avatar-${avatar}`
}

/** Clave de animación: `<avatar>-<idle|walk>-<dirección>`. */
export function animKey(avatar: string, state: AnimState, dir: Direction): string {
  return `${avatar}-${state}-${dir}`
}

/** Frame quieto mirando abajo: el que se muestra como retrato. */
export const PORTRAIT_FRAME = ANIM_START.idle.down

/**
 * Registra las animaciones de caminar/quieto en cuatro direcciones para todos
 * los avatares del catálogo. Idempotente: las animaciones viven en el
 * AnimationManager global del juego, así que reiniciar la escena no duplica.
 */
export function createAvatarAnims(anims: Phaser.Animations.AnimationManager) {
  for (const avatar of AVATAR_IDS) {
    for (const state of ['idle', 'walk'] as const) {
      for (const dir of DIRECTIONS) {
        const key = animKey(avatar, state, dir)
        if (anims.exists(key)) continue
        const start = ANIM_START[state][dir]
        anims.create({
          key,
          frames: anims.generateFrameNumbers(textureKey(avatar), {
            start,
            end: start + FRAMES_PER_ANIM - 1,
          }),
          frameRate: state === 'walk' ? 15 : 9,
          repeat: -1,
        })
      }
    }
  }
}
