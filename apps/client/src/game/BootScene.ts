import Phaser from 'phaser'
import {
  AGENT_TYPE_IDS,
  AVATAR_FRAME,
  AVATAR_IDS,
  MASCOT_FRAME,
  allLayerSheets,
  type WorldDefinition,
} from '@vto/shared'
import { layerSheetUrl, layerTextureKey, textureKey } from './avatarAnims'
import { MASCOT_KEY_PREFIX, mascotTextureKey } from './mascotAnims'
import { queueTilesets, queueWorldMap } from './worldAssets'

/** Key of the Taller logo texture (decoration for the reception). */
export const LOGO_KEY = 'logo-taller'

/** Prefix of the avatar texture keys (see `textureKey`). */
const AVATAR_KEY_PREFIX = 'avatar-'
/** Prefix of the avatar layer texture keys. */
const LAYER_KEY_PREFIX = 'layer-'

/**
 * Loads the initial world's map and, by reading its tilesets, queues the
 * images that map needs. That way adding a tileset in Tiled does not require
 * touching code: the image is resolved relative to the map file, just like in
 * Tiled. It also loads the sprite sheets of the catalogue's avatars and one
 * per kind of agent mascot, which are the same in every world: which of them a
 * player uses is only known once their state arrives, so they are all in the
 * cache before anybody is drawn. The maps of the other worlds are loaded when
 * their door is crossed (see `worldAssets.ts`).
 */
export class BootScene extends Phaser.Scene {
  private world: WorldDefinition
  private avatarsUrl: string
  private mascotsUrl: string
  private logoUrl: string
  private failed = false

  constructor(world: WorldDefinition, avatarsUrl: string, mascotsUrl: string, logoUrl: string) {
    super('boot')
    this.world = world
    this.avatarsUrl = avatarsUrl
    this.mascotsUrl = mascotsUrl
    this.logoUrl = logoUrl
  }

  preload() {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // An avatar, a mascot or the logo failing to load is degradable: the
      // office goes on with a default avatar, with the mascots it could load
      // (a type whose sheet is missing falls back to the robot, see
      // `drawableMascotType`) and without the logo. A missing map or tileset
      // is fatal.
      if (
        file.key.startsWith(AVATAR_KEY_PREFIX) ||
        file.key.startsWith(LAYER_KEY_PREFIX) ||
        file.key.startsWith(MASCOT_KEY_PREFIX) ||
        file.key === LOGO_KEY
      ) {
        console.warn(`[assets] could not load ${file.src} (carrying on without it)`)
        return
      }
      this.fail(`Could not load ${file.src}`)
    })
    queueWorldMap(this, this.world)
    this.load.image(LOGO_KEY, this.logoUrl)
    // The agent mascots: one sheet per type in the catalogue, the same in
    // every world.
    for (const type of AGENT_TYPE_IDS) {
      this.load.spritesheet(mascotTextureKey(type), `${this.mascotsUrl}${type}.png`, {
        frameWidth: MASCOT_FRAME.width,
        frameHeight: MASCOT_FRAME.height,
      })
    }
    for (const id of AVATAR_IDS) {
      this.load.spritesheet(textureKey(id), `${this.avatarsUrl}${id}.png`, {
        frameWidth: AVATAR_FRAME.width,
        frameHeight: AVATAR_FRAME.height,
      })
    }

    // Layers for composed avatars: body (per skin tone), hair, top and
    // accessories, every one of them cut for one silhouette.
    // The catalogue lists them and names their files, so a part added there is
    // loaded here and drawn by the entry screen's preview without more work.
    for (const sheet of allLayerSheets()) {
      this.load.spritesheet(
        layerTextureKey(sheet.group, sheet.part, sheet.variant),
        layerSheetUrl(this.avatarsUrl, sheet),
        { frameWidth: AVATAR_FRAME.width, frameHeight: AVATAR_FRAME.height },
      )
    }
  }

  create() {
    if (this.failed) return
    const problem = queueTilesets(this, this.world)
    if (problem) return this.fail(problem)

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.failed) this.scene.start('office', { worldId: this.world.id })
    })
    this.load.start()
  }

  private fail(message: string) {
    if (this.failed) return
    this.failed = true
    console.error(`[map] ${message}`)
    const { width, height } = this.scale
    this.add
      .text(width / 2, height / 2, `Could not load the office.\n${message}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ff5d6c',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 40) },
      })
      .setOrigin(0.5)
  }
}
