import Phaser from 'phaser'
import { mapUrlFor, type TiledMap, type WorldDefinition } from '@vto/shared'

/**
 * Loading of the worlds' maps.
 *
 * Each world has its own Tiled file and its tilesets; the map enters the cache
 * under a per-world key, so travelling does not overwrite what was already
 * loaded and going back to a world already visited is instant. The tilesets'
 * images are resolved relative to the map file, just like in Tiled: adding a
 * tileset does not require touching code.
 */

/** Key under which a world's map is kept in Phaser's cache. */
export function mapKey(worldId: string): string {
  return `map-${worldId}`
}

/** The already-loaded map of a world. */
export function worldMapData(scene: Phaser.Scene, worldId: string): TiledMap {
  return scene.cache.tilemap.get(mapKey(worldId)).data as TiledMap
}

/** Are the world's map and the images of all its tilesets in the cache? */
export function isWorldLoaded(scene: Phaser.Scene, worldId: string): boolean {
  const entry = scene.cache.tilemap.get(mapKey(worldId)) as { data?: TiledMap } | undefined
  if (!entry?.data) return false
  return entry.data.tilesets.every((ts) => scene.textures.exists(ts.name))
}

/** Queues the JSON of a world's map; the caller starts the loader. */
export function queueWorldMap(scene: Phaser.Scene, world: WorldDefinition) {
  scene.load.tilemapTiledJSON(mapKey(world.id), mapUrlFor(world))
}

/**
 * Queues the images of the tilesets of the map already read. Returns the
 * problem if the map does not meet the contract (tileset not embedded), or
 * `undefined` if everything was queued.
 */
export function queueTilesets(scene: Phaser.Scene, world: WorldDefinition): string | undefined {
  const raw = (scene.cache.tilemap.get(mapKey(world.id)) as { data?: TiledMap } | undefined)?.data
  if (!raw) return `The map of "${world.name}" has no data`

  const base = new URL(mapUrlFor(world), window.location.href)
  for (const tileset of raw.tilesets) {
    if (!tileset.image) {
      return `The tileset "${tileset.name}" is not embedded in the map (use "Embed in map" in Tiled)`
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
 * Full load (map + tilesets) of a world with the scene already running: this
 * is what happens when crossing a door. If something fails, it rejects with
 * the reason and the caller decides (the office stays playable in the world
 * it is in).
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

/** Starts the scene's loader and waits for it to finish, with the error if there was one. */
function runLoader(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = scene.load
    let failure: string | undefined
    const onError = (file: Phaser.Loader.File) => {
      failure = `Could not load ${file.src}`
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
