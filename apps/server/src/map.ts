import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findSpawnPoint,
  getMapBounds,
  MapError,
  validateMap,
  validateWorldDoors,
  WORLDS,
  type MapBounds,
  type SpawnPoint,
  type TiledMap,
  type WorldDefinition,
} from '@vto/shared'

/**
 * Folder of the maps: the same one the client serves, so there is a single
 * source of truth. It is resolved relative to this module so that it works
 * both in development (`apps/server/src`) and bundled (`apps/server/build`):
 * in both cases `../../client/...` lands in `apps/client`.
 */
export const MAP_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/public/assets/map',
)

/** Path of a world's map file. */
export function mapFileFor(world: WorldDefinition): string {
  return resolve(MAP_DIR, world.mapFile)
}

/** The map of the first world; used by the tests and the startup messages. */
export const DEFAULT_MAP_FILE = mapFileFor(WORLDS[0])

export interface OfficeMap {
  file: string
  data: TiledMap
  /** Entry point to the world (the spawn without a name). */
  spawn: SpawnPoint
  bounds: MapBounds
}

/** A world's map, already read and validated. */
export interface WorldMap extends OfficeMap {
  world: WorldDefinition
}

/**
 * Reads and validates a Tiled map. Fails with a clear message if the file
 * does not exist or does not meet the contract (see `docs/map.md`): better
 * not to start than to put players into a broken map.
 */
export function loadOfficeMap(file: string): OfficeMap {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw new MapError(`Could not read the map "${file}" (${describe(error)}). Check the path.`)
  }

  let data: TiledMap
  try {
    data = JSON.parse(raw) as TiledMap
  } catch (error) {
    throw new MapError(`The map "${file}" is not valid JSON: ${describe(error)}`)
  }

  const problems = validateMap(data)
  if (problems.length > 0) {
    throw new MapError(`The map "${file}" is not valid:\n - ${problems.join('\n - ')}`)
  }

  return { file, data, spawn: findSpawnPoint(data), bounds: getMapBounds(data) }
}

/**
 * Reads the maps of every world and also validates the doors **between**
 * worlds: a door leading to a world or a spawn that does not exist leaves
 * someone locked in, so the server does not start and says which one it is.
 */
export function loadWorldMaps(worlds: readonly WorldDefinition[] = WORLDS): Map<string, WorldMap> {
  const loaded = new Map<string, WorldMap>()
  for (const world of worlds) {
    const map = loadOfficeMap(mapFileFor(world))
    loaded.set(world.id, { ...map, world })
  }

  const byId: Record<string, TiledMap> = {}
  for (const [id, map] of loaded) byId[id] = map.data
  const problems = validateWorldDoors(byId)
  if (problems.length > 0) {
    throw new MapError(`There are doors that lead nowhere:\n - ${problems.join('\n - ')}`)
  }
  return loaded
}

let cached: Map<string, WorldMap> | undefined

/** The maps of every world, read and validated once per process. */
export function worldMaps(): Map<string, WorldMap> {
  cached ??= loadWorldMaps()
  return cached
}

/** A world's map. Throws if that world is not configured. */
export function worldMap(worldId: string): WorldMap {
  const map = worldMaps().get(worldId)
  if (!map) throw new MapError(`There is no world configured with the id "${worldId}"`)
  return map
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
