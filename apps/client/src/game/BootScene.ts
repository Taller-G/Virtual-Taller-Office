import Phaser from 'phaser'
import type { TiledMap } from '@vto/shared'

/** Clave con la que el mapa queda en la caché de Phaser. */
export const MAP_KEY = 'office-map'

/**
 * Carga el mapa Tiled JSON y, leyendo sus tilesets, encola las imágenes que
 * ese mapa necesita. Así agregar un tileset en Tiled no requiere tocar código:
 * la imagen se resuelve relativa al archivo del mapa, igual que en Tiled.
 */
export class BootScene extends Phaser.Scene {
  private mapUrl: string
  private failed = false

  constructor(mapUrl: string) {
    super('boot')
    this.mapUrl = mapUrl
  }

  preload() {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.fail(`No se pudo cargar ${file.src}`)
    })
    this.load.tilemapTiledJSON(MAP_KEY, this.mapUrl)
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
      .text(width / 2, height / 2, `No se pudo cargar el mapa de la oficina.\n${message}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ff5d6c',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 40) },
      })
      .setOrigin(0.5)
  }
}
