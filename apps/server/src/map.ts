import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findSpawnPoint,
  getMapBounds,
  MapError,
  validateMap,
  type MapBounds,
  type SpawnPoint,
  type TiledMap,
} from '@vto/shared'

/**
 * Ruta por defecto del mapa: el mismo archivo que sirve el cliente, así hay
 * una única fuente de verdad. Se resuelve relativa a este módulo para que
 * funcione tanto en desarrollo (`apps/server/src`) como empaquetado
 * (`apps/server/build`): en ambos casos `../../client/...` cae en `apps/client`.
 */
export const DEFAULT_MAP_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/public/assets/map/oficina-taller.json',
)

export interface OfficeMap {
  file: string
  data: TiledMap
  spawn: SpawnPoint
  bounds: MapBounds
}

/**
 * Lee y valida el mapa Tiled. Falla con un mensaje claro si el archivo no
 * existe o no cumple el contrato (ver `docs/mapa.md`): mejor no arrancar que
 * meter jugadores en un mapa roto.
 */
export function loadOfficeMap(file: string): OfficeMap {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw new MapError(
      `No se pudo leer el mapa "${file}" (${describe(error)}). Configurá MAP_FILE o revisá la ruta.`,
    )
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
