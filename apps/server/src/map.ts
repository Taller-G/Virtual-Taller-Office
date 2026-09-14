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
 * Carpeta de los mapas: la misma que sirve el cliente, así hay una única
 * fuente de verdad. Se resuelve relativa a este módulo para que funcione tanto
 * en desarrollo (`apps/server/src`) como empaquetado (`apps/server/build`):
 * en ambos casos `../../client/...` cae en `apps/client`.
 */
export const MAP_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/public/assets/map',
)

/** Ruta del archivo de mapa de un mundo. */
export function mapFileFor(world: WorldDefinition): string {
  return resolve(MAP_DIR, world.mapFile)
}

/** El mapa del primer mundo; lo usan las pruebas y los mensajes de arranque. */
export const DEFAULT_MAP_FILE = mapFileFor(WORLDS[0])

export interface OfficeMap {
  file: string
  data: TiledMap
  /** Punto de entrada al mundo (el spawn sin nombre). */
  spawn: SpawnPoint
  bounds: MapBounds
}

/** El mapa de un mundo, ya leído y validado. */
export interface WorldMap extends OfficeMap {
  world: WorldDefinition
}

/**
 * Lee y valida un mapa Tiled. Falla con un mensaje claro si el archivo no
 * existe o no cumple el contrato (ver `docs/mapa.md`): mejor no arrancar que
 * meter jugadores en un mapa roto.
 */
export function loadOfficeMap(file: string): OfficeMap {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw new MapError(`No se pudo leer el mapa "${file}" (${describe(error)}). Revisá la ruta.`)
  }

  let data: TiledMap
  try {
    data = JSON.parse(raw) as TiledMap
  } catch (error) {
    throw new MapError(`El mapa "${file}" no es JSON válido: ${describe(error)}`)
  }

  const problems = validateMap(data)
  if (problems.length > 0) {
    throw new MapError(`El mapa "${file}" no es válido:\n - ${problems.join('\n - ')}`)
  }

  return { file, data, spawn: findSpawnPoint(data), bounds: getMapBounds(data) }
}

/**
 * Lee los mapas de todos los mundos y valida además las puertas **entre**
 * mundos: una puerta que lleva a un mundo o a un spawn que no existe deja a
 * alguien encerrado, así que el servidor no arranca y dice cuál es.
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
    throw new MapError(`Hay puertas que no llevan a ninguna parte:\n - ${problems.join('\n - ')}`)
  }
  return loaded
}

let cached: Map<string, WorldMap> | undefined

/** Los mapas de todos los mundos, leídos y validados una sola vez por proceso. */
export function worldMaps(): Map<string, WorldMap> {
  cached ??= loadWorldMaps()
  return cached
}

/** El mapa de un mundo. Lanza si ese mundo no está configurado. */
export function worldMap(worldId: string): WorldMap {
  const map = worldMaps().get(worldId)
  if (!map) throw new MapError(`No hay un mundo configurado con el id "${worldId}"`)
  return map
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
