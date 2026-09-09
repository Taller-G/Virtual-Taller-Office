import Phaser from 'phaser'
import {
  ANIM_START,
  APPEARANCE_BASES,
  AVATAR_IDS,
  DEFAULT_AVATAR,
  DIRECTIONS,
  FRAMES_PER_ANIM,
  GLASSES_OPTIONS,
  HAT_OPTIONS,
  SKIN_TONES,
  type Direction,
} from '@vto/shared'

export type AnimState = 'idle' | 'walk'

/** Clave de textura (hoja de sprites) de un avatar en la caché de Phaser. */
export function textureKey(avatar: string): string {
  return `avatar-${avatar}`
}

/**
 * Clave de textura para una capa de avatar compuesto.
 * Ejemplos: `layer-adam-body-default`, `layer-ash-hair`, `layer-acc-beanie`.
 */
export function layerTextureKey(group: string, part: string, variant?: string): string {
  return variant ? `layer-${group}-${part}-${variant}` : `layer-${group}-${part}`
}

/**
 * Devuelve un avatar cuya hoja de sprites cargó de verdad: el pedido si existe,
 * si no el avatar por defecto, y si tampoco (caso extremo) el primero disponible.
 * Así, si falta un sheet, el jugador entra igual con un avatar válido.
 */
export function resolveLoadedAvatar(
  textures: Phaser.Textures.TextureManager,
  avatar: string,
): string {
  if (textures.exists(textureKey(avatar))) return avatar
  if (textures.exists(textureKey(DEFAULT_AVATAR))) return DEFAULT_AVATAR
  return AVATAR_IDS.find((id) => textures.exists(textureKey(id))) ?? avatar
}

/** Clave de animación: `<avatar>-<idle|walk>-<dirección>`. */
export function animKey(avatar: string, state: AnimState, dir: Direction): string {
  return `${avatar}-${state}-${dir}`
}

/** Frame quieto mirando abajo: el que se muestra como retrato. */
export const PORTRAIT_FRAME = ANIM_START.idle.down

/** Clave de animación para una capa: `<textureKey>-<idle|walk>-<dir>`. */
export function layerAnimKey(textureKey: string, state: AnimState, dir: Direction): string {
  return `${textureKey}-${state}-${dir}`
}

/**
 * Registra animaciones idle/walk para una textura de capa si existe y si las
 * animaciones no están ya registradas. Misma cadencia y frames que los presets.
 */
function registerLayerAnims(scene: Phaser.Scene, texKey: string): void {
  if (!scene.textures.exists(texKey)) return
  const anims = scene.anims
  for (const state of ['idle', 'walk'] as const) {
    for (const dir of DIRECTIONS) {
      const key = layerAnimKey(texKey, state, dir)
      if (anims.exists(key)) continue
      const start = ANIM_START[state][dir]
      anims.create({
        key,
        frames: anims.generateFrameNumbers(texKey, {
          start,
          end: start + FRAMES_PER_ANIM - 1,
        }),
        frameRate: state === 'walk' ? 15 : 9,
        repeat: -1,
      })
    }
  }
}

/**
 * Registra las animaciones de caminar/quieto en cuatro direcciones para todos
 * los avatares del catálogo y todas las capas de avatares compuestos.
 * Idempotente: las animaciones viven en el AnimationManager global del juego,
 * así que reiniciar la escena no duplica.
 */
export function createAvatarAnims(scene: Phaser.Scene) {
  const anims = scene.anims
  // Presets: avatares completos (single-sheet).
  for (const avatar of AVATAR_IDS) {
    if (!scene.textures.exists(textureKey(avatar))) continue
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

  // Capas: body (por tono), hair, top, accesorios.
  for (const base of APPEARANCE_BASES) {
    for (const tone of SKIN_TONES) {
      registerLayerAnims(scene, layerTextureKey(base, 'body', tone))
    }
    registerLayerAnims(scene, layerTextureKey(base, 'hair'))
    registerLayerAnims(scene, layerTextureKey(base, 'top'))
  }
  for (const acc of [...HAT_OPTIONS, ...GLASSES_OPTIONS]) {
    if (acc === 'none') continue
    registerLayerAnims(scene, layerTextureKey('acc', acc))
  }
}
