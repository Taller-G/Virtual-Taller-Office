import Phaser from 'phaser'
import {
  AGENT_TYPE_IDS,
  ANIM_START,
  FRAMES_PER_ANIM,
  DEFAULT_AGENT_TYPE,
  DIRECTIONS,
  sanitizeAgentType,
  type Direction,
} from '@vto/shared'
import type { AnimState } from './avatarAnims'

/**
 * Animations of the agent mascots, the little companions that walk behind a
 * player.
 *
 * There is one sheet per type in the catalogue and they all share the frame
 * layout of the avatars (see `ANIM_START`), so the registration below is the
 * avatars' loop run once per type. Which type a given player's mascots are is
 * the server's state; this module only knows how to name and build them.
 */

/** Texture key of a type's sprite sheet in Phaser's cache: `mascot-<id>`. */
export function mascotTextureKey(type: string): string {
  return `mascot-${type}`
}

/** Prefix every mascot texture key starts with (the loader tests for it). */
export const MASCOT_KEY_PREFIX = 'mascot-'

/** The default type's texture, which is what a missing sheet falls back to. */
export const MASCOT_TEXTURE = mascotTextureKey(DEFAULT_AGENT_TYPE)

/** Animation key: `mascot-<type>-<idle|walk>-<direction>`. */
export function mascotAnimKey(type: string, state: AnimState, dir: Direction): string {
  return `mascot-${type}-${state}-${dir}`
}

/**
 * The type a player's mascots can actually be drawn as: the one they chose if
 * its sheet is in the cache, the default robot if it is not, and nothing at
 * all if even that failed to load. A type outside the catalogue is treated as
 * unknown here too, so a state written by a newer server cannot reach Phaser
 * as a texture key nobody loaded.
 *
 * It is what keeps a sheet that did not download from costing a player their
 * agents: they come back as robots rather than as an empty patch of floor or
 * an exception in the middle of the scene's update.
 */
export function drawableMascotType(scene: Phaser.Scene, type: string): string | undefined {
  const wanted = sanitizeAgentType(type)
  if (scene.textures.exists(mascotTextureKey(wanted))) return wanted
  if (scene.textures.exists(MASCOT_TEXTURE)) return DEFAULT_AGENT_TYPE
  return undefined
}

/**
 * Registers every type's idle/walk animations in four directions. Idempotent
 * (the animations live in the game's global manager) and it skips the types
 * whose sheet did not load: a missing mascot leaves the office running with
 * the ones that did.
 */
export function createMascotAnims(scene: Phaser.Scene): void {
  const anims = scene.anims
  for (const type of AGENT_TYPE_IDS) {
    const texture = mascotTextureKey(type)
    if (!scene.textures.exists(texture)) continue
    for (const state of ['idle', 'walk'] as const) {
      for (const dir of DIRECTIONS) {
        const key = mascotAnimKey(type, state, dir)
        if (anims.exists(key)) continue
        const start = ANIM_START[state][dir]
        anims.create({
          key,
          frames: anims.generateFrameNumbers(texture, { start, end: start + FRAMES_PER_ANIM - 1 }),
          // A shade slower than a person's: little legs, shorter stride.
          frameRate: state === 'walk' ? 12 : 7,
          repeat: -1,
        })
      }
    }
  }
}
