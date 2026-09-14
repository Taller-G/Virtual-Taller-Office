import Phaser from 'phaser'
import {
  APPEARANCE_BASES,
  AVATAR_FRAME,
  AVATAR_IDS,
  GLASSES_OPTIONS,
  HAT_OPTIONS,
  SKIN_TONES,
  type WorldDefinition,
} from '@vto/shared'
import { layerTextureKey, textureKey } from './avatarAnims'
import { queueTilesets, queueWorldMap } from './worldAssets'

/** Clave de la textura del logo de Taller (decoración de la recepción). */
export const LOGO_KEY = 'logo-taller'

/** Prefijo de las claves de textura de avatar (ver `textureKey`). */
const AVATAR_KEY_PREFIX = 'avatar-'
/** Prefijo de las claves de textura de capas de avatar. */
const LAYER_KEY_PREFIX = 'layer-'

/**
 * Carga el mapa del mundo inicial y, leyendo sus tilesets, encola las imágenes
 * que ese mapa necesita. Así agregar un tileset en Tiled no requiere tocar
 * código: la imagen se resuelve relativa al archivo del mapa, igual que en
 * Tiled. También carga las hojas de sprites de los avatares del catálogo, que
 * son las mismas en todos los mundos. Los mapas de los demás mundos se cargan
 * al cruzar su puerta (ver `worldAssets.ts`).
 */
export class BootScene extends Phaser.Scene {
  private world: WorldDefinition
  private avatarsUrl: string
  private logoUrl: string
  private failed = false

  constructor(world: WorldDefinition, avatarsUrl: string, logoUrl: string) {
    super('boot')
    this.world = world
    this.avatarsUrl = avatarsUrl
    this.logoUrl = logoUrl
  }

  preload() {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // Un avatar o el logo que no cargan son degradables: la oficina sigue con
      // un avatar por defecto y sin logo. Faltar el mapa o un tileset sí es fatal.
      if (
        file.key.startsWith(AVATAR_KEY_PREFIX) ||
        file.key.startsWith(LAYER_KEY_PREFIX) ||
        file.key === LOGO_KEY
      ) {
        console.warn(`[assets] no se pudo cargar ${file.src} (se sigue sin él)`)
        return
      }
      this.fail(`No se pudo cargar ${file.src}`)
    })
    queueWorldMap(this, this.world)
    this.load.image(LOGO_KEY, this.logoUrl)
    for (const id of AVATAR_IDS) {
      this.load.spritesheet(textureKey(id), `${this.avatarsUrl}${id}.png`, {
        frameWidth: AVATAR_FRAME.width,
        frameHeight: AVATAR_FRAME.height,
      })
    }

    // Capas para avatares compuestos: body (por tono de piel), hair, top, accesorios.
    const layersUrl = `${this.avatarsUrl}layers/`
    for (const base of APPEARANCE_BASES) {
      for (const tone of SKIN_TONES) {
        this.load.spritesheet(
          layerTextureKey(base, 'body', tone),
          `${layersUrl}${base}/body-${tone}.png`,
          { frameWidth: AVATAR_FRAME.width, frameHeight: AVATAR_FRAME.height },
        )
      }
      for (const part of ['hair', 'top'] as const) {
        this.load.spritesheet(layerTextureKey(base, part), `${layersUrl}${base}/${part}.png`, {
          frameWidth: AVATAR_FRAME.width,
          frameHeight: AVATAR_FRAME.height,
        })
      }
    }
    for (const acc of [...HAT_OPTIONS, ...GLASSES_OPTIONS]) {
      if (acc === 'none') continue
      this.load.spritesheet(layerTextureKey('acc', acc), `${layersUrl}accessories/${acc}.png`, {
        frameWidth: AVATAR_FRAME.width,
        frameHeight: AVATAR_FRAME.height,
      })
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
    console.error(`[mapa] ${message}`)
    const { width, height } = this.scale
    this.add
      .text(width / 2, height / 2, `No se pudo cargar la oficina.\n${message}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ff5d6c',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 40) },
      })
      .setOrigin(0.5)
  }
}
