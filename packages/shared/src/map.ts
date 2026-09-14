/**
 * Contrato entre el mapa (archivo Tiled JSON editado por el equipo) y la app.
 *
 * La app NO depende de nombres de capas: recorre todas las capas en el orden
 * en que están en Tiled y decide qué hacer con cada una según su tipo y sus
 * propiedades personalizadas. Así se puede reemplazar el archivo del mapa por
 * otro válido sin tocar código. Ver `docs/mapa.md`.
 */

import { isDirection, type Direction } from './avatars'

/** Propiedad booleana que marca colisión: en tiles del tileset, en capas de objetos o en objetos. */
export const PROP_COLLIDES = 'collides'
/**
 * Clase (campo "type"/"class" en Tiled) de los puntos de aparición. El que no
 * tiene nombre es la entrada al mundo (uno por mapa); los demás se nombran y
 * son destino de las puertas de otros mundos.
 */
export const CLASS_SPAWN = 'spawn'
/** Clase de los rectángulos que nombran zonas de la oficina (recepción, cocina…). */
export const CLASS_ZONE = 'zone'
/** Propiedad opcional (px) del spawn: los jugadores aparecen repartidos dentro de ese radio. */
export const PROP_SPAWN_RADIUS = 'radius'
/** Radio por defecto si el spawn no define `radius`. */
export const DEFAULT_SPAWN_RADIUS = 32
/** Propiedad opcional del spawn: hacia dónde mira quien aparece ahí. */
export const PROP_SPAWN_DIR = 'dir'
/** Dirección por defecto si el spawn no define `dir`. */
export const DEFAULT_SPAWN_DIR: Direction = 'down'
/**
 * Nombre del spawn por el que se entra a un mundo. Un objeto `spawn` sin
 * nombre en Tiled cuenta como este; los demás son puntos de llegada de puertas.
 */
export const DEFAULT_SPAWN_NAME = 'default'

/**
 * Clase de los rectángulos que llevan a otro mundo. Se cruzan caminando: no
 * hay tecla ni confirmación. Ver `docs/mapa.md`.
 */
export const CLASS_DOOR = 'door'
/** Propiedad obligatoria de una puerta: id del mundo destino. */
export const PROP_DOOR_WORLD = 'world'
/** Propiedad obligatoria de una puerta: nombre del spawn de llegada en ese mundo. */
export const PROP_DOOR_SPAWN = 'spawn'

/**
 * Propiedad opcional del mapa: color ambiente (`#AARRGGBB` de Tiled) con el
 * que el cliente tiñe el mundo entero. Así un mundo puede verse oscuro sin
 * dibujar tiles nuevos.
 */
export const PROP_AMBIENT = 'ambient'

// ---------------------------------------------------------------------------
// Subconjunto del formato Tiled JSON (https://doc.mapeditor.org/en/stable/reference/json-map-format/)
// ---------------------------------------------------------------------------

export interface TiledProperty {
  name: string
  type?: string
  value: unknown
}

export interface TiledObject {
  id: number
  name?: string
  /** Tiled <= 1.8 y el JSON actual usan "type"; Tiled >= 1.9 también expone "class". */
  type?: string
  class?: string
  x: number
  y: number
  width?: number
  height?: number
  gid?: number
  point?: boolean
  visible?: boolean
  properties?: TiledProperty[]
}

export interface TiledTileLayer {
  type: 'tilelayer'
  id: number
  name: string
  visible?: boolean
  width: number
  height: number
  data: number[]
  properties?: TiledProperty[]
}

export interface TiledObjectLayer {
  type: 'objectgroup'
  id: number
  name: string
  visible?: boolean
  objects: TiledObject[]
  properties?: TiledProperty[]
}

export interface TiledGroupLayer {
  type: 'group'
  id: number
  name: string
  visible?: boolean
  layers: TiledLayer[]
  properties?: TiledProperty[]
}

export interface TiledImageLayer {
  type: 'imagelayer'
  id: number
  name: string
  visible?: boolean
  properties?: TiledProperty[]
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledGroupLayer | TiledImageLayer

export interface TiledTile {
  id: number
  properties?: TiledProperty[]
}

export interface TiledTileset {
  name: string
  firstgid: number
  image: string
  imagewidth: number
  imageheight: number
  tilewidth: number
  tileheight: number
  tilecount: number
  columns: number
  margin?: number
  spacing?: number
  tiles?: TiledTile[]
}

export interface TiledMap {
  type?: 'map'
  orientation: string
  width: number
  height: number
  tilewidth: number
  tileheight: number
  infinite?: boolean
  layers: TiledLayer[]
  tilesets: TiledTileset[]
  properties?: TiledProperty[]
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface SpawnPoint {
  /** Nombre del objeto en Tiled; `default` si no tiene. Único dentro del mapa. */
  name: string
  x: number
  y: number
  radius: number
  /** Hacia dónde queda mirando quien aparece acá. */
  dir: Direction
}

/**
 * Puerta a otro mundo: un rectángulo que, al pisarlo, manda al jugador al
 * mundo `world`, al spawn llamado `spawn`. La validación cruzada entre mapas
 * (`validateWorldDoors`) garantiza que ese destino exista.
 */
export interface Door {
  /** Id del objeto en Tiled: identifica la puerta en los mensajes de error. */
  id: number
  /** Nombre del objeto en Tiled (opcional); vacío si no tiene. */
  name: string
  /** Id del mundo destino. */
  world: string
  /** Nombre del spawn de llegada en el mundo destino. */
  spawn: string
  x: number
  y: number
  width: number
  height: number
}

export interface Zone {
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface MapBounds {
  width: number
  height: number
}

/** Bits de volteo que Tiled guarda en los gid de los objetos. */
const GID_FLAG_MASK = 0x1fffffff

export function getProperty<T = unknown>(
  props: TiledProperty[] | undefined,
  name: string,
): T | undefined {
  return props?.find((p) => p.name === name)?.value as T | undefined
}

/** Clase del objeto (Tiled la llama "class" en la UI y "type" en el JSON). */
export function objectClass(obj: TiledObject): string {
  return obj.class || obj.type || ''
}

/** Todas las capas, aplanando grupos, en orden de dibujo (de abajo hacia arriba). */
export function flattenLayers(layers: TiledLayer[]): Exclude<TiledLayer, TiledGroupLayer>[] {
  const out: Exclude<TiledLayer, TiledGroupLayer>[] = []
  for (const layer of layers) {
    if (layer.type === 'group') out.push(...flattenLayers(layer.layers))
    else out.push(layer)
  }
  return out
}

export function objectLayers(map: TiledMap): TiledObjectLayer[] {
  return flattenLayers(map.layers).filter((l): l is TiledObjectLayer => l.type === 'objectgroup')
}

export function tileLayers(map: TiledMap): TiledTileLayer[] {
  return flattenLayers(map.layers).filter((l): l is TiledTileLayer => l.type === 'tilelayer')
}

export function allObjects(map: TiledMap): TiledObject[] {
  return objectLayers(map).flatMap((l) => l.objects)
}

/**
 * Un objeto colisiona si lo dice su propia propiedad `collides`; si no la
 * tiene, hereda la de su capa; si tampoco, no colisiona.
 */
export function objectCollides(layer: TiledObjectLayer, obj: TiledObject): boolean {
  const own = getProperty<boolean>(obj.properties, PROP_COLLIDES)
  if (typeof own === 'boolean') return own
  return getProperty<boolean>(layer.properties, PROP_COLLIDES) === true
}

export function getMapBounds(map: TiledMap): MapBounds {
  return { width: map.width * map.tilewidth, height: map.height * map.tileheight }
}

/** Tileset al que pertenece un gid (el de mayor firstgid <= gid). */
export function tilesetForGid(map: TiledMap, rawGid: number): TiledTileset | undefined {
  const gid = rawGid & GID_FLAG_MASK
  let found: TiledTileset | undefined
  for (const ts of map.tilesets) {
    if (ts.firstgid <= gid && (!found || ts.firstgid > found.firstgid)) found = ts
  }
  return found
}

/** ¿El tile con este gid tiene `collides: true` en su tileset? */
export function tileCollides(map: TiledMap, rawGid: number): boolean {
  const gid = rawGid & GID_FLAG_MASK
  if (gid === 0) return false
  const ts = tilesetForGid(map, gid)
  if (!ts) return false
  const tile = ts.tiles?.find((t) => t.id === gid - ts.firstgid)
  return getProperty<boolean>(tile?.properties, PROP_COLLIDES) === true
}

/** ¿Alguna capa de tiles tiene un tile que colisiona en la posición (px)? */
export function isSolidAt(map: TiledMap, x: number, y: number): boolean {
  const col = Math.floor(x / map.tilewidth)
  const row = Math.floor(y / map.tileheight)
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return true
  return tileLayers(map).some((layer) => tileCollides(map, layer.data[row * layer.width + col]))
}

export function findSpawnPoints(map: TiledMap): SpawnPoint[] {
  return allObjects(map)
    .filter((o) => objectClass(o) === CLASS_SPAWN)
    .map((o) => {
      const dir = getProperty(o.properties, PROP_SPAWN_DIR)
      return {
        name: spawnName(o),
        // Para un rectángulo tomamos su centro; un punto tiene ancho/alto 0.
        x: o.x + (o.width ?? 0) / 2,
        y: o.y + (o.height ?? 0) / 2,
        radius: Number(getProperty(o.properties, PROP_SPAWN_RADIUS) ?? DEFAULT_SPAWN_RADIUS),
        dir: isDirection(dir) ? dir : DEFAULT_SPAWN_DIR,
      }
    })
}

/**
 * Nombre del spawn: el del objeto en Tiled, o `default` si no tiene. El objeto
 * de la oficina de hoy se llama "spawn"; también cuenta como el por defecto,
 * así los mapas viejos siguen valiendo.
 */
function spawnName(obj: TiledObject): string {
  const name = (obj.name ?? '').trim()
  return name === '' || name === CLASS_SPAWN ? DEFAULT_SPAWN_NAME : name
}

/**
 * El punto de aparición llamado `name` (el por defecto si no se pide otro).
 * Lanza si no hay exactamente uno: mejor fallar al cargar el mapa que dejar a
 * alguien apareciendo en cualquier lado.
 */
export function findSpawnPoint(map: TiledMap, name = DEFAULT_SPAWN_NAME): SpawnPoint {
  const spawns = findSpawnPoints(map).filter((s) => s.name === name)
  if (spawns.length !== 1) {
    throw new MapError(
      `El mapa debe tener exactamente un objeto de clase "${CLASS_SPAWN}" llamado "${name}" (tiene ${spawns.length})`,
    )
  }
  return spawns[0]
}

/** Las puertas del mapa, en el orden en que están en Tiled. */
export function findDoors(map: TiledMap): Door[] {
  return allObjects(map)
    .filter((o) => objectClass(o) === CLASS_DOOR)
    .map((o) => ({
      id: o.id,
      name: (o.name ?? '').trim(),
      world: String(getProperty(o.properties, PROP_DOOR_WORLD) ?? '').trim(),
      spawn: String(getProperty(o.properties, PROP_DOOR_SPAWN) ?? '').trim(),
      x: o.x,
      y: o.y,
      width: o.width ?? 0,
      height: o.height ?? 0,
    }))
}

/** La puerta (si la hay) que contiene el punto. */
export function doorAt(map: TiledMap, x: number, y: number): Door | undefined {
  return findDoors(map).find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height)
}

/** Cómo se nombra una puerta en los mensajes de error. */
export function doorLabel(door: Door): string {
  return door.name ? `"${door.name}" (objeto ${door.id})` : `objeto ${door.id}`
}

/** Color ambiente del mapa (`#AARRGGBB`), si lo define. */
export function getAmbient(map: TiledMap): string | undefined {
  const value = getProperty(map.properties, PROP_AMBIENT)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function getZones(map: TiledMap): Zone[] {
  return allObjects(map)
    .filter((o) => objectClass(o) === CLASS_ZONE && (o.width ?? 0) > 0 && (o.height ?? 0) > 0)
    .map((o) => ({
      name: o.name ?? '',
      x: o.x,
      y: o.y,
      width: o.width ?? 0,
      height: o.height ?? 0,
    }))
}

/** Posición aleatoria dentro del radio del spawn, acotada al mapa. */
export function randomSpawnPosition(
  spawn: SpawnPoint,
  bounds: MapBounds,
  random: () => number = Math.random,
): { x: number; y: number } {
  const angle = random() * Math.PI * 2
  const distance = random() * spawn.radius
  return {
    x: clamp(Math.round(spawn.x + Math.cos(angle) * distance), 0, bounds.width),
    y: clamp(Math.round(spawn.y + Math.sin(angle) * distance), 0, bounds.height),
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export class MapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapError'
  }
}

/**
 * Chequeos mínimos para que un mapa inválido falle temprano (al arrancar el
 * servidor o en las pruebas) con un mensaje útil, y no con un error críptico
 * en el cliente. Devuelve la lista de problemas; vacía si el mapa sirve.
 */
export function validateMap(map: TiledMap): string[] {
  const problems: string[] = []
  if (map.orientation !== 'orthogonal') problems.push('El mapa debe ser ortogonal')
  if (map.infinite) problems.push('El mapa no puede ser infinito (fijá el tamaño en Tiled)')
  if (!(map.width > 0 && map.height > 0)) problems.push('El mapa no tiene tamaño')
  if (!map.tilesets?.length) problems.push('El mapa no tiene tilesets')
  for (const ts of map.tilesets ?? []) {
    if (!ts.image) {
      problems.push(
        `El tileset "${ts.name}" no está embebido (tiene que ser "Embed in map" en Tiled)`,
      )
    }
  }
  if (tileLayers(map).length === 0) problems.push('El mapa no tiene capas de tiles')

  const spawns = findSpawnPoints(map)
  const entries = spawns.filter((s) => s.name === DEFAULT_SPAWN_NAME)
  if (entries.length !== 1) {
    problems.push(
      `Debe haber exactamente un objeto de clase "${CLASS_SPAWN}" sin nombre (la entrada al mundo); hay ${entries.length}`,
    )
  }
  const seen = new Set<string>()
  for (const spawn of spawns) {
    if (seen.has(spawn.name)) problems.push(`Hay más de un spawn llamado "${spawn.name}"`)
    seen.add(spawn.name)
    if (isSolidAt(map, spawn.x, spawn.y)) {
      problems.push(`El spawn "${spawn.name}" cae sobre un tile que colisiona`)
    }
  }

  for (const door of findDoors(map)) {
    const label = doorLabel(door)
    if (!(door.width > 0 && door.height > 0)) {
      problems.push(`La puerta ${label} no tiene área: tiene que ser un rectángulo`)
    }
    if (!door.world) {
      problems.push(
        `La puerta ${label} no declara la propiedad "${PROP_DOOR_WORLD}" (mundo destino)`,
      )
    }
    if (!door.spawn) {
      problems.push(
        `La puerta ${label} no declara la propiedad "${PROP_DOOR_SPAWN}" (spawn de llegada)`,
      )
    }
  }
  return problems
}

/**
 * Validación cruzada entre los mapas de todos los mundos: cada puerta tiene
 * que llevar a un mundo que exista y a un spawn que ese mundo defina. Se corre
 * al arrancar el servidor y en las pruebas: una puerta rota es un mundo del
 * que no se sale o al que se llega a ninguna parte.
 */
export function validateWorldDoors(maps: Record<string, TiledMap>): string[] {
  const problems: string[] = []
  const known = Object.keys(maps)
  for (const worldId of known) {
    for (const door of findDoors(maps[worldId])) {
      // Las puertas sin destino ya las reporta `validateMap`.
      if (!door.world || !door.spawn) continue
      const target = maps[door.world]
      if (!target) {
        problems.push(
          `La puerta ${doorLabel(door)} del mundo "${worldId}" lleva al mundo "${door.world}", que no existe (mundos: ${known.join(', ')})`,
        )
        continue
      }
      const names = findSpawnPoints(target).map((s) => s.name)
      if (!names.includes(door.spawn)) {
        problems.push(
          `La puerta ${doorLabel(door)} del mundo "${worldId}" llega al spawn "${door.spawn}" del mundo "${door.world}", que no lo define (spawns: ${names.join(', ')})`,
        )
      }
    }
  }
  return problems
}
