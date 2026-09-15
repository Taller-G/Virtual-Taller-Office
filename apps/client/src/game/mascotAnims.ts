import Phaser from 'phaser'
import { ANIM_START, DIRECTIONS, FRAMES_PER_ANIM, type Direction } from '@vto/shared'
import type { AnimState } from './avatarAnims'

/**
 * Animations of the agent mascot, the little robot that walks behind a
 * player.
 *
 * There is a single sheet for every mascot in the office — they are all the
 * same robot — so, unlike the avatars', its texture key is a constant. The
 * frame layout is the avatars' own (see `ANIM_START`), which is why the
 * registration below is the same loop with one texture instead of a
 * catalogue.
 */

/** Texture key of the robot's sprite sheet in Phaser's cache. */
export const MASCOT_TEXTURE = 'mascot-robot'

/** Animation key: `mascot-<idle|walk>-<direction>`. */
export function mascotAnimKey(state: AnimState, dir: Direction): string {
  return `mascot-${state}-${dir}`
}

/**
 * Registers the mascot's idle/walk animations in four directions. Idempotent
 * (the animations live in the game's global manager) and a no-op if the sheet
 * did not load: a missing robot leaves the office running without mascots.
 */
export function createMascotAnims(scene: Phaser.Scene): void {
  if (!scene.textures.exists(MASCOT_TEXTURE)) return
  const anims = scene.anims
  for (const state of ['idle', 'walk'] as const) {
    for (const dir of DIRECTIONS) {
      const key = mascotAnimKey(state, dir)
      if (anims.exists(key)) continue
      const start = ANIM_START[state][dir]
      anims.create({
        key,
        frames: anims.generateFrameNumbers(MASCOT_TEXTURE, {
          start,
          end: start + FRAMES_PER_ANIM - 1,
        }),
        // A shade slower than a person's: little legs, shorter stride.
        frameRate: state === 'walk' ? 12 : 7,
        repeat: -1,
      })
    }
  }
}
