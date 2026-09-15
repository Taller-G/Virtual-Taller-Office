/**
 * Contract between the map (a Tiled JSON file edited by the team) and the app.
 *
 * The app does NOT depend on layer names: it walks every layer in the order
 * they have in Tiled and decides what to do with each one from its type and
 * its custom properties. That way the map file can be replaced by another
 * valid one without touching code. See `docs/map.md`.
 */

import { isDirection, type Direction } from './avatars'

/** Boolean property that marks collision: on tileset tiles, on object layers or on objects. */
export const PROP_COLLIDES = 'collides'
/**
 * Class (the "type"/"class" field in Tiled) of the spawn points. The one
 * without a name is the entrance to the world (one per map); the others are
 * named and are the destination of doors in other worlds.
 */
export const CLASS_SPAWN = 'spawn'
/** Class of the rectangles that name areas of the office (reception, kitchen...). */
export const CLASS_ZONE = 'zone'
/**
 * Boolean property of a zone: this room is a **meeting room**, one a meeting
 * can be scheduled into. Its seats (the ones inside its rectangle) are the
 * chairs around its big table, and entering a meeting seats people in them.
 * Marking a room in the map rather than listing rooms in code is what lets
 * someone add a meeting room in Tiled without touching the app.
 */
export const PROP_ZONE_MEETING = 'meeting'
/** Optional property (px) of a spawn: players appear scattered within that radius. */
export const PROP_SPAWN_RADIUS = 'radius'
/** Default radius if the spawn does not define `radius`. */
export const DEFAULT_SPAWN_RADIUS = 32
/** Optional property of a spawn: which way whoever appears there faces. */
export const PROP_SPAWN_DIR = 'dir'
/** Default direction if the spawn does not define `dir`. */
export const DEFAULT_SPAWN_DIR: Direction = 'down'
/**
 * Name of the spawn a world is entered through. A `spawn` object without a
 * name in Tiled counts as this one; the rest are arrival points of doors.
 */
export const DEFAULT_SPAWN_NAME = 'default'

/**
 * Class of the rectangles that lead to another world. They are crossed by
 * walking: there is no key press and no confirmation. See `docs/map.md`.
 */
export const CLASS_DOOR = 'door'
/** Required property of a door: id of the destination world. */
export const PROP_DOOR_WORLD = 'world'
/** Required property of a door: name of the arrival spawn in that world. */
export const PROP_DOOR_SPAWN = 'spawn'

/**
 * Class of the rectangles you can sit at: a chair in front of a desk. Sitting
 * down is what puts someone in the "focused" state, so a seat is a place in
 * the world, not a feature of the app. See `docs/map.md`.
 */
export const CLASS_SEAT = 'seat'
/**
 * Optional property of a seat: which way whoever sits there faces (towards
 * the desk). Same values as a spawn's `dir`.
 */
export const PROP_SEAT_DIR = PROP_SPAWN_DIR
/** Default facing of a seat that does not declare `dir`. */
export const DEFAULT_SEAT_DIR: Direction = 'down'

/**
 * Optional property of the map: ambient colour (Tiled's `#AARRGGBB`) with
 * which the client tints the whole world. That way a world can look dark
 * without drawing new tiles.
 */
export const PROP_AMBIENT = 'ambient'

// ---------------------------------------------------------------------------
// Subset of the Tiled JSON format (https://doc.mapeditor.org/en/stable/reference/json-map-format/)
// ---------------------------------------------------------------------------

export interface TiledProperty {
  name: string
  type?: string
  value: unknown
}

export interface TiledObject {
  id: number
  name?: string
  /** Tiled <= 1.8 and the current JSON use "type"; Tiled >= 1.9 also exposes "class". */
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
// Reading
// ---------------------------------------------------------------------------

export interface SpawnPoint {
  /** Name of the object in Tiled; `default` if it has none. Unique within the map. */
  name: string
  x: number
  y: number
  radius: number
  /** Which way whoever appears here ends up facing. */
  dir: Direction
}

/**
 * Door to another world: a rectangle that, when stepped on, sends the player
 * to the world `world`, to the spawn named `spawn`. The cross-map validation
 * (`validateWorldDoors`) guarantees that destination exists.
 */
export interface Door {
  /** Id of the object in Tiled: identifies the door in error messages. */
  id: number
  /** Name of the object in Tiled (optional); empty if it has none. */
  name: string
  /** Id of the destination world. */
  world: string
  /** Name of the arrival spawn in the destination world. */
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
  /** The room a meeting can be held in (property `meeting` in Tiled). */
  meeting: boolean
}

/** A rectangle in map pixels. Zones, seats, doors and bodies are all this. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A room a meeting can be scheduled into: a zone marked `meeting` together
 * with the seats around its big table (every seat inside its rectangle, in the
 * order the map has them). The name is what a meeting names, so it has to be
 * unique among the meeting rooms of a world.
 */
export interface MeetingRoom extends Zone {
  seats: Seat[]
}

/**
 * A place to sit: the chair of a focus desk. Sitting down is what puts
 * someone in the "focused" state, so the world is what decides where that is
 * possible and which way you end up facing.
 *
 * The `name` identifies the seat everywhere (it is what travels in the
 * messages and in `player.seatId`), so it has to be unique within the map.
 */
export interface Seat {
  /** Id of the object in Tiled: identifies the seat in error messages. */
  id: number
  /** Unique name within the map; this is the seat's id in the state. */
  name: string
  x: number
  y: number
  width: number
  height: number
  /** Which way whoever sits here faces: towards the desk. */
  dir: Direction
}

export interface MapBounds {
  width: number
  height: number
}

/** Flip bits that Tiled stores in the gids of the objects. */
const GID_FLAG_MASK = 0x1fffffff

export function getProperty<T = unknown>(
  props: TiledProperty[] | undefined,
  name: string,
): T | undefined {
  return props?.find((p) => p.name === name)?.value as T | undefined
}

/** Class of the object (Tiled calls it "class" in the UI and "type" in the JSON). */
export function objectClass(obj: TiledObject): string {
  return obj.class || obj.type || ''
}

/** Every layer, flattening groups, in draw order (from bottom to top). */
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
 * An object collides if its own `collides` property says so; if it does not
 * have one, it inherits its layer's; if there is none either, it does not
 * collide.
 */
export function objectCollides(layer: TiledObjectLayer, obj: TiledObject): boolean {
  const own = getProperty<boolean>(obj.properties, PROP_COLLIDES)
  if (typeof own === 'boolean') return own
  return getProperty<boolean>(layer.properties, PROP_COLLIDES) === true
}

export function getMapBounds(map: TiledMap): MapBounds {
  return { width: map.width * map.tilewidth, height: map.height * map.tileheight }
}

/** Tileset a gid belongs to (the one with the greatest firstgid <= gid). */
export function tilesetForGid(map: TiledMap, rawGid: number): TiledTileset | undefined {
  const gid = rawGid & GID_FLAG_MASK
  let found: TiledTileset | undefined
  for (const ts of map.tilesets) {
    if (ts.firstgid <= gid && (!found || ts.firstgid > found.firstgid)) found = ts
  }
  return found
}

/** Does the tile with this gid have `collides: true` in its tileset? */
export function tileCollides(map: TiledMap, rawGid: number): boolean {
  const gid = rawGid & GID_FLAG_MASK
  if (gid === 0) return false
  const ts = tilesetForGid(map, gid)
  if (!ts) return false
  const tile = ts.tiles?.find((t) => t.id === gid - ts.firstgid)
  return getProperty<boolean>(tile?.properties, PROP_COLLIDES) === true
}

/** Does any tile layer have a colliding tile at the position (px)? */
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
        // For a rectangle we take its centre; a point has width/height 0.
        x: o.x + (o.width ?? 0) / 2,
        y: o.y + (o.height ?? 0) / 2,
        radius: Number(getProperty(o.properties, PROP_SPAWN_RADIUS) ?? DEFAULT_SPAWN_RADIUS),
        dir: isDirection(dir) ? dir : DEFAULT_SPAWN_DIR,
      }
    })
}

/**
 * Name of the spawn: the object's in Tiled, or `default` if it has none. The
 * object in today's office is called "spawn"; it also counts as the default
 * one, so older maps keep working.
 */
function spawnName(obj: TiledObject): string {
  const name = (obj.name ?? '').trim()
  return name === '' || name === CLASS_SPAWN ? DEFAULT_SPAWN_NAME : name
}

/**
 * The spawn point called `name` (the default one if no other is asked for).
 * Throws if there is not exactly one: better to fail while loading the map
 * than to leave someone appearing just anywhere.
 */
export function findSpawnPoint(map: TiledMap, name = DEFAULT_SPAWN_NAME): SpawnPoint {
  const spawns = findSpawnPoints(map).filter((s) => s.name === name)
  if (spawns.length !== 1) {
    throw new MapError(
      `The map must have exactly one object of class "${CLASS_SPAWN}" named "${name}" (it has ${spawns.length})`,
    )
  }
  return spawns[0]
}

/** The doors of the map, in the order they have in Tiled. */
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

/** The door (if any) that contains the point. */
export function doorAt(map: TiledMap, x: number, y: number): Door | undefined {
  return findDoors(map).find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height)
}

/**
 * The door (if any) the rectangle touches: this is what the client uses with
 * the player's body, so that stepping on the threshold is enough and the
 * exact centre of the body does not have to be inside the area.
 */
export function doorAtRect(map: TiledMap, rect: Rect): Door | undefined {
  return findDoors(map).find((d) => rectsOverlap(rect, d))
}

/** How a door is named in error messages. */
export function doorLabel(door: Door): string {
  return door.name ? `"${door.name}" (object ${door.id})` : `object ${door.id}`
}

/** Ambient colour of the map (`#AARRGGBB`), if it defines one. */
export function getAmbient(map: TiledMap): string | undefined {
  const value = getProperty(map.properties, PROP_AMBIENT)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** The seats of the map, in the order they have in Tiled. */
export function findSeats(map: TiledMap): Seat[] {
  return allObjects(map)
    .filter((o) => objectClass(o) === CLASS_SEAT)
    .map((o) => {
      const dir = getProperty(o.properties, PROP_SEAT_DIR)
      return {
        id: o.id,
        name: (o.name ?? '').trim(),
        x: o.x,
        y: o.y,
        width: o.width ?? 0,
        height: o.height ?? 0,
        dir: isDirection(dir) ? dir : DEFAULT_SEAT_DIR,
      }
    })
}

/** The seat called `name`, or `undefined` if the map has no such seat. */
export function seatByName(map: TiledMap, name: string): Seat | undefined {
  const wanted = name.trim()
  return wanted === '' ? undefined : findSeats(map).find((s) => s.name === wanted)
}

/**
 * The seat (if any) the rectangle touches. It is used with the player's
 * **physics body** (the feet), like `doorAtRect`: standing on the chair is
 * enough, the exact centre of the body does not have to be inside it.
 */
export function seatAtRect(map: TiledMap, rect: Rect): Seat | undefined {
  return findSeats(map).find((s) => rectsOverlap(rect, s))
}

/**
 * Where an avatar stands once it sits down: the centre of the seat. The
 * server pins whoever sits there to this point, so everyone draws them in the
 * same place and nobody has to agree on anything else.
 */
export function seatAnchor(seat: Seat): { x: number; y: number } {
  return { x: Math.round(seat.x + seat.width / 2), y: Math.round(seat.y + seat.height / 2) }
}

/**
 * The avatar's physics body ("the feet") for a position: smaller than the
 * sprite, so it fits through one-tile doorways. Doors and seats are both
 * decided against this rectangle rather than against a point.
 *
 * It lives here, and not only in the client that draws it, because the server
 * has to answer the very same question — "is this player still at that
 * seat?" — and a second, slightly different notion of where someone is
 * standing is exactly what makes a seat let go of somebody who never moved.
 */
export const PLAYER_BODY = { width: 18, height: 12 } as const

/** The player's body rectangle at a position (their origin is its top centre). */
export function playerBodyRect(x: number, y: number): Rect {
  return {
    x: x - PLAYER_BODY.width / 2,
    y,
    width: PLAYER_BODY.width,
    height: PLAYER_BODY.height,
  }
}

/** Is the player at that position still standing on (or in) the given seat? */
export function isAtSeat(seat: Seat, x: number, y: number): boolean {
  return rectsOverlap(playerBodyRect(x, y), seat)
}

/** How a seat is named in error messages. */
export function seatLabel(seat: Seat): string {
  return seat.name ? `"${seat.name}" (object ${seat.id})` : `object ${seat.id}`
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
      meeting: getProperty<boolean>(o.properties, PROP_ZONE_MEETING) === true,
    }))
}

/** Does the rectangle contain the point? */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

/** Do the two rectangles touch? Doors, seats and bodies are all resolved this way. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Is the whole rectangle inside the other one? */
export function rectWithin(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/**
 * The rooms a meeting can be held in: the zones marked `meeting`, each with
 * the seats that fall inside it — the chairs around its big table. The order
 * is the map's, so the seats of a room are always offered in the same order
 * and "the first free seat" means the same thing on every client.
 */
export function findMeetingRooms(map: TiledMap): MeetingRoom[] {
  const seats = findSeats(map)
  return getZones(map)
    .filter((zone) => zone.meeting)
    .map((zone) => ({
      ...zone,
      seats: seats.filter((seat) => {
        const { x, y } = seatAnchor(seat)
        return rectContains(zone, x, y)
      }),
    }))
}

/** The meeting room called `name`, or `undefined` if this map has no such room. */
export function meetingRoomByName(map: TiledMap, name: string): MeetingRoom | undefined {
  const wanted = name.trim()
  return wanted === '' ? undefined : findMeetingRooms(map).find((room) => room.name === wanted)
}

/**
 * The rectangles of the furniture that blocks the way: the tile objects with
 * `collides` (their own, or their layer's). Tiled anchors a tile object by its
 * bottom-left corner, which is why the top edge is `y - height`.
 *
 * The client turns these same objects into physics bodies; the server needs
 * them to answer "is there room to stand here?" without a physics engine.
 */
export function solidObjectRects(map: TiledMap): Rect[] {
  const rects: Rect[] = []
  for (const layer of objectLayers(map)) {
    for (const obj of layer.objects) {
      if (obj.visible === false || !obj.gid || !objectCollides(layer, obj)) continue
      const width = obj.width ?? 0
      const height = obj.height ?? 0
      rects.push({ x: obj.x, y: obj.y - height, width, height })
    }
  }
  return rects
}

/**
 * Is there room for somebody to stand with their origin at this point? The
 * whole **body** has to fit: on floor that is not solid, clear of the solid
 * furniture and clear of `blocked` (the seats of the room and whoever is
 * already standing there).
 */
export function canStandAt(
  map: TiledMap,
  x: number,
  y: number,
  blocked: readonly Rect[] = [],
  solids: readonly Rect[] = solidObjectRects(map),
): boolean {
  const body = playerBodyRect(x, y)
  const corners = [
    [body.x, body.y],
    [body.x + body.width, body.y],
    [body.x, body.y + body.height],
    [body.x + body.width, body.y + body.height],
    [body.x + body.width / 2, body.y + body.height / 2],
  ] as const
  if (corners.some(([cx, cy]) => isSolidAt(map, cx, cy))) return false
  if (solids.some((rect) => rectsOverlap(body, rect))) return false
  return !blocked.some((rect) => rectsOverlap(body, rect))
}

/** How far apart the candidate standing spots of a room are sampled, in px. */
export const STANDING_SPOT_STEP = 16

/**
 * Where somebody can stand inside a room: every point on a `step` lattice
 * whose body fits entirely within the room, on free floor, off the furniture,
 * off the chairs and clear of `blocked`. Closest to the middle of the room
 * first, so whoever arrives to a full table ends up beside it rather than in
 * a far corner.
 *
 * This is what makes "the table is full" an ordinary outcome instead of an
 * error: there is always somewhere legal to put a person inside the room.
 */
export function freeStandingSpots(
  map: TiledMap,
  room: Zone,
  blocked: readonly Rect[] = [],
  step = STANDING_SPOT_STEP,
): { x: number; y: number }[] {
  const solids = solidObjectRects(map)
  const centerX = room.x + room.width / 2
  const centerY = room.y + room.height / 2
  const spots: { x: number; y: number; d: number }[] = []
  for (let y = room.y; y <= room.y + room.height; y += step) {
    for (let x = room.x; x <= room.x + room.width; x += step) {
      const body = playerBodyRect(x, y)
      if (!rectWithin(body, room)) continue
      if (!canStandAt(map, x, y, blocked, solids)) continue
      spots.push({ x, y, d: Math.hypot(x - centerX, y - centerY) })
    }
  }
  return spots.sort((a, b) => a.d - b.d).map(({ x, y }) => ({ x, y }))
}

/** Random position within the spawn's radius, clamped to the map. */
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
 * Minimum checks so that an invalid map fails early (when the server starts
 * or in the tests) with a useful message, instead of with a cryptic error on
 * the client. Returns the list of problems; empty if the map is usable.
 */
export function validateMap(map: TiledMap): string[] {
  const problems: string[] = []
  if (map.orientation !== 'orthogonal') problems.push('The map must be orthogonal')
  if (map.infinite) problems.push('The map cannot be infinite (set a fixed size in Tiled)')
  if (!(map.width > 0 && map.height > 0)) problems.push('The map has no size')
  if (!map.tilesets?.length) problems.push('The map has no tilesets')
  for (const ts of map.tilesets ?? []) {
    if (!ts.image) {
      problems.push(
        `The tileset "${ts.name}" is not embedded (it has to be "Embed in map" in Tiled)`,
      )
    }
  }
  if (tileLayers(map).length === 0) problems.push('The map has no tile layers')

  const spawns = findSpawnPoints(map)
  const entries = spawns.filter((s) => s.name === DEFAULT_SPAWN_NAME)
  if (entries.length !== 1) {
    problems.push(
      `There must be exactly one object of class "${CLASS_SPAWN}" without a name (the entrance to the world); there are ${entries.length}`,
    )
  }
  const seen = new Set<string>()
  for (const spawn of spawns) {
    if (seen.has(spawn.name)) problems.push(`There is more than one spawn named "${spawn.name}"`)
    seen.add(spawn.name)
    if (isSolidAt(map, spawn.x, spawn.y)) {
      problems.push(`The spawn "${spawn.name}" falls on a colliding tile`)
    }
  }

  for (const door of findDoors(map)) {
    const label = doorLabel(door)
    if (!(door.width > 0 && door.height > 0)) {
      problems.push(`The door ${label} has no area: it has to be a rectangle`)
    }
    if (!door.world) {
      problems.push(
        `The door ${label} does not declare the property "${PROP_DOOR_WORLD}" (destination world)`,
      )
    }
    if (!door.spawn) {
      problems.push(
        `The door ${label} does not declare the property "${PROP_DOOR_SPAWN}" (arrival spawn)`,
      )
    }
  }

  const seatNames = new Set<string>()
  for (const seat of findSeats(map)) {
    const label = seatLabel(seat)
    if (!(seat.width > 0 && seat.height > 0)) {
      problems.push(`The seat ${label} has no area: it has to be a rectangle`)
    }
    if (!seat.name) {
      problems.push(`The seat ${label} has no name, and the name is what identifies it`)
    } else if (seatNames.has(seat.name)) {
      problems.push(`There is more than one seat named "${seat.name}"`)
    }
    seatNames.add(seat.name)
    // A seat you cannot walk onto is a seat nobody can sit in.
    const { x, y } = seatAnchor(seat)
    if (isSolidAt(map, x, y)) problems.push(`The seat ${label} falls on a colliding tile`)
  }

  const roomNames = new Set<string>()
  for (const room of findMeetingRooms(map)) {
    if (!room.name) {
      problems.push(
        `There is a zone marked "${PROP_ZONE_MEETING}" without a name, and the name is what a meeting books`,
      )
    } else if (roomNames.has(room.name)) {
      problems.push(`There is more than one meeting room named "${room.name}"`)
    }
    roomNames.add(room.name)
    // A meeting room with no seat inside it is a room nobody can sit down in,
    // and one with nowhere to stand strands whoever arrives to a full table.
    if (room.seats.length === 0) {
      problems.push(
        `The meeting room "${room.name}" has no seat inside it: a meeting there would seat nobody`,
      )
    }
    if (freeStandingSpots(map, room, room.seats).length === 0) {
      problems.push(
        `The meeting room "${room.name}" has nowhere to stand: whoever enters a full table would have no room`,
      )
    }
  }
  return problems
}

/**
 * Cross-validation between the maps of every world: each door has to lead to
 * a world that exists and to a spawn that world defines. It runs when the
 * server starts and in the tests: a broken door is a world you cannot leave
 * or one you arrive nowhere in.
 */
export function validateWorldDoors(maps: Record<string, TiledMap>): string[] {
  const problems: string[] = []
  const known = Object.keys(maps)
  for (const worldId of known) {
    for (const door of findDoors(maps[worldId])) {
      // Doors without a destination are already reported by `validateMap`.
      if (!door.world || !door.spawn) continue
      const target = maps[door.world]
      if (!target) {
        problems.push(
          `The door ${doorLabel(door)} of world "${worldId}" leads to world "${door.world}", which does not exist (worlds: ${known.join(', ')})`,
        )
        continue
      }
      const names = findSpawnPoints(target).map((s) => s.name)
      if (!names.includes(door.spawn)) {
        problems.push(
          `The door ${doorLabel(door)} of world "${worldId}" arrives at spawn "${door.spawn}" of world "${door.world}", which does not define it (spawns: ${names.join(', ')})`,
        )
      }
    }
  }
  return problems
}
