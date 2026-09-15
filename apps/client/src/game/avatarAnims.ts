import Phaser from 'phaser'
import {
  ANIM_START,
  AVATAR_IDS,
  DEFAULT_AVATAR,
  DIRECTIONS,
  FRAMES_PER_ANIM,
  allLayerSheets,
  layerSheetFile,
  type AppearanceLayer,
  type Direction,
} from '@vto/shared'

export type AnimState = 'idle' | 'walk'

/** Texture key (sprite sheet) of an avatar in Phaser's cache. */
export function textureKey(avatar: string): string {
  return `avatar-${avatar}`
}

/**
 * Texture key for a layer of a composed avatar.
 * Examples: `layer-adam-body-default`, `layer-ash-hair`, `layer-ash-beanie`.
 */
export function layerTextureKey(group: string, part: string, variant?: string): string {
  return variant ? `layer-${group}-${part}-${variant}` : `layer-${group}-${part}`
}

/**
 * URL of a layer's sprite sheet: the catalogue names the file, this puts it
 * under the avatars folder. Phaser's loader and the entry screen's preview
 * (which fetches the same sheets itself, outside the game) both go through it.
 */
export function layerSheetUrl(
  avatarsUrl: string,
  layer: Pick<AppearanceLayer, 'group' | 'part' | 'variant'>,
): string {
  return `${avatarsUrl}layers/${layerSheetFile(layer)}`
}

/**
 * Returns an avatar whose sprite sheet really loaded: the requested one if it
 * exists, otherwise the default avatar, and failing that (an extreme case) the
 * first available one. That way, if a sheet is missing, the player still
 * joins with a valid avatar.
 */
export function resolveLoadedAvatar(
  textures: Phaser.Textures.TextureManager,
  avatar: string,
): string {
  if (textures.exists(textureKey(avatar))) return avatar
  if (textures.exists(textureKey(DEFAULT_AVATAR))) return DEFAULT_AVATAR
  return AVATAR_IDS.find((id) => textures.exists(textureKey(id))) ?? avatar
}

/** Animation key: `<avatar>-<idle|walk>-<direction>`. */
export function animKey(avatar: string, state: AnimState, dir: Direction): string {
  return `${avatar}-${state}-${dir}`
}

/** Idle frame facing down: the one shown as a portrait. */
export const PORTRAIT_FRAME = ANIM_START.idle.down

/** Animation key for a layer: `<textureKey>-<idle|walk>-<dir>`. */
export function layerAnimKey(textureKey: string, state: AnimState, dir: Direction): string {
  return `${textureKey}-${state}-${dir}`
}

/**
 * Registers idle/walk animations for a layer texture if it exists and if the
 * animations are not registered already. Same cadence and frames as the
 * presets.
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
 * Registers the walk/idle animations in four directions for every avatar in
 * the catalogue and every layer of composed avatars. Idempotent: the
 * animations live in the game's global AnimationManager, so restarting the
 * scene does not duplicate them.
 */
export function createAvatarAnims(scene: Phaser.Scene) {
  const anims = scene.anims
  // Presets: full avatars (single-sheet).
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

  // Layers: body (per tone), hair, top, accessories — the catalogue's list.
  // All of them are cut per silhouette, accessories included.
  for (const sheet of allLayerSheets()) {
    registerLayerAnims(scene, layerTextureKey(sheet.group, sheet.part, sheet.variant))
  }
}
