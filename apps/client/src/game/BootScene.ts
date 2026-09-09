import Phaser from 'phaser'
import {
  APPEARANCE_BASES,
  AVATAR_FRAME,
  AVATAR_IDS,
  GLASSES_OPTIONS,
  HAT_OPTIONS,
  SKIN_TONES,
  type TiledMap,
} from '@vto/shared'
import { layerTextureKey, textureKey } from './avatarAnims'

/** Clave con la que el mapa queda en la caché de Phaser. */
export const MAP_KEY = 'office-map'
/** Clave de la textura del logo de Taller (decoración de la recepción). */
export const LOGO_KEY = 'logo-taller'

/** Prefijo de las claves de textura de avatar (ver `textureKey`). */
const AVATAR_KEY_PREFIX = 'avatar-'
/** Prefijo de las claves de textura de capas de avatar. */
const LAYER_KEY_PREFIX = 'layer-'

/**
 * Carga el mapa Tiled JSON y, leyendo sus tilesets, encola las imágenes que
 * ese mapa necesita. Así agregar un tileset en Tiled no requiere tocar código:
 * la imagen se resuelve relativa al archivo del mapa, igual que en Tiled.
 * También carga las hojas de sprites de los avatares del catálogo.
 */
export class BootScene extends Phaser.Scene {
  private mapUrl: string
  private avatarsUrl: string
  private logoUrl: string
  private failed = false

  constructor(mapUrl: string, avatarsUrl: string, logoUrl: string) {
    super('boot')
    this.mapUrl = mapUrl
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
    this.load.tilemapTiledJSON(MAP_KEY, this.mapUrl)
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
    const raw = this.cache.tilemap.get(MAP_KEY)?.data as TiledMap | undefined
    if (!raw) return this.fail(`El mapa ${this.mapUrl} no tiene datos`)

    const mapBase = new URL(this.mapUrl, window.location.href)
    for (const tileset of raw.tilesets) {
      if (!tileset.image) {
        return this.fail(
          `El tileset "${tileset.name}" no está embebido en el mapa (usá "Embed in map" en Tiled)`,
        )
      }
      this.load.spritesheet(tileset.name, new URL(tileset.image, mapBase).toString(), {
        frameWidth: tileset.tilewidth,
        frameHeight: tileset.tileheight,
        margin: tileset.margin ?? 0,
        spacing: tileset.spacing ?? 0,
      })
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.failed) this.scene.start('office')
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
