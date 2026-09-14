import Phaser from 'phaser'
import { mapUrlFor, type TiledMap, type WorldDefinition } from '@vto/shared'

/**
 * Carga de los mapas de los mundos.
 *
 * Cada mundo tiene su propio archivo Tiled y sus tilesets; el mapa entra a la
 * caché con una clave por mundo, así viajar no pisa lo que ya estaba cargado y
 * volver a un mundo visitado es instantáneo. Las imágenes de los tilesets se
 * resuelven relativas al archivo del mapa, igual que en Tiled: agregar un
 * tileset no requiere tocar código.
 */

/** Clave con la que el mapa de un mundo queda en la caché de Phaser. */
export function mapKey(worldId: string): string {
  return `map-${worldId}`
}

/** El mapa ya cargado de un mundo. */
export function worldMapData(scene: Phaser.Scene, worldId: string): TiledMap {
  return scene.cache.tilemap.get(mapKey(worldId)).data as TiledMap
}

/** ¿Están en la caché el mapa del mundo y las imágenes de todos sus tilesets? */
export function isWorldLoaded(scene: Phaser.Scene, worldId: string): boolean {
  const entry = scene.cache.tilemap.get(mapKey(worldId)) as { data?: TiledMap } | undefined
  if (!entry?.data) return false
  return entry.data.tilesets.every((ts) => scene.textures.exists(ts.name))
}

/** Encola el JSON del mapa de un mundo; el que llama arranca el loader. */
export function queueWorldMap(scene: Phaser.Scene, world: WorldDefinition) {
  scene.load.tilemapTiledJSON(mapKey(world.id), mapUrlFor(world))
}

/**
 * Encola las imágenes de los tilesets del mapa ya leído. Devuelve el problema
 * si el mapa no cumple el contrato (tileset sin embeber), o `undefined` si
 * quedó todo encolado.
 */
export function queueTilesets(scene: Phaser.Scene, world: WorldDefinition): string | undefined {
  const raw = (scene.cache.tilemap.get(mapKey(world.id)) as { data?: TiledMap } | undefined)?.data
  if (!raw) return `El mapa de "${world.name}" no tiene datos`

  const base = new URL(mapUrlFor(world), window.location.href)
  for (const tileset of raw.tilesets) {
    if (!tileset.image) {
      return `El tileset "${tileset.name}" no está embebido en el mapa (usá "Embed in map" en Tiled)`
    }
    if (scene.textures.exists(tileset.name)) continue
    scene.load.spritesheet(tileset.name, new URL(tileset.image, base).toString(), {
      frameWidth: tileset.tilewidth,
      frameHeight: tileset.tileheight,
      margin: tileset.margin ?? 0,
      spacing: tileset.spacing ?? 0,
    })
  }
  return undefined
}

/**
 * Carga completa (mapa + tilesets) de un mundo con la escena ya andando: es lo
 * que se hace al cruzar una puerta. Si algo falla, rechaza con el motivo y el
 * que llama decide (la oficina sigue jugable en el mundo donde está).
 */
export async function loadWorld(scene: Phaser.Scene, world: WorldDefinition): Promise<void> {
  if (isWorldLoaded(scene, world.id)) return
  if (!scene.cache.tilemap.exists(mapKey(world.id))) {
    queueWorldMap(scene, world)
    await runLoader(scene)
  }
  const problem = queueTilesets(scene, world)
  if (problem) throw new Error(problem)
  await runLoader(scene)
}

/** Arranca el loader de la escena y espera a que termine, con el error si lo hubo. */
function runLoader(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = scene.load
    let failure: string | undefined
    const onError = (file: Phaser.Loader.File) => {
      failure = `No se pudo cargar ${file.src}`
    }
    loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError)
    loader.once(Phaser.Loader.Events.COMPLETE, () => {
      loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError)
      if (failure) reject(new Error(failure))
      else resolve()
    })
    loader.start()
  })
}
