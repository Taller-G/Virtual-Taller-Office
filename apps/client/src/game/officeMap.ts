import Phaser from 'phaser'
import {
  CLASS_DOOR,
  CLASS_SEAT,
  CLASS_SPAWN,
  CLASS_ZONE,
  DEFAULT_SPAWN_NAME,
  findDoors,
  findSeats,
  findSpawnPoints,
  flattenLayers,
  getAmbient,
  getMapBounds,
  getZones,
  objectClass,
  objectCollides,
  PROP_COLLIDES,
  tilesetForGid,
  worldName,
  type Door,
  type Seat,
  type SpawnPoint,
  type TiledMap,
  type TiledObject,
  type TiledObjectLayer,
} from '@vto/shared'
import { LOGO_KEY } from './BootScene'
import { mapKey } from './worldAssets'

/** Name of the zone (in the Tiled map) the Taller logo is anchored to. */
const LOGO_ZONE = 'Reception'
/**
 * Position of the logo within the reception zone, as a fraction of its width
 * and from its top edge in px. Chosen so it lands on the free floor left
 * between the waiting bench and the counter, below the monitor: it is the
 * rightmost clear stretch where the logo (160 px wide) fits whole without
 * covering any furniture or spilling out of the reception.
 */
const LOGO_ZONE_FRAC_X = 0.5
const LOGO_ZONE_OFFSET_Y = 64

/** Flip bits that Tiled stores in an object's gid. */
const FLIP_H = 0x80000000
const FLIP_V = 0x40000000
const GID_MASK = 0x1fffffff

/** Depth of the tile layers: always below furniture and avatars. */
const TILE_LAYER_DEPTH_BASE = -1000
/** The logo goes as a floor decal: over the tiles but below furniture and avatars. */
const LOGO_DEPTH = TILE_LAYER_DEPTH_BASE + 100
/** Doors are painted as a floor decal: you walk over them. */
const DOOR_DEPTH = TILE_LAYER_DEPTH_BASE + 200
/** Zone labels go above everything that walks around the map. */
export const OVERLAY_DEPTH = 100_000
/** The world's ambient colour is painted over everything except the labels. */
const AMBIENT_DEPTH = OVERLAY_DEPTH - 10

/** Colour of the doors: the same on the map and in the debug view. */
const DOOR_COLOR = 0xa78bfa
/** Colour of the seats in the debug view. */
const SEAT_COLOR = 0x34d399

export interface BuiltMap {
  /** World this map belongs to. */
  worldId: string
  raw: TiledMap
  tilemap: Phaser.Tilemaps.Tilemap
  bounds: { width: number; height: number }
  /** Tile layers with at least one colliding tile. */
  collisionLayers: Phaser.Tilemaps.TilemapLayer[]
  /** Furniture that blocks the way. */
  solids: Phaser.Physics.Arcade.StaticGroup
  /** Doors to other worlds: crossed by walking (see `OfficeScene`). */
  doors: Door[]
  /** Places you can sit at to be "focused" (see `OfficeScene`). */
  seats: Seat[]
  /** Every spawn point, the entrance one and the arrival ones. */
  spawns: SpawnPoint[]
  spawn?: { x: number; y: number }
}

/**
 * Builds the office from the Tiled map, without depending on layer names: it
 * walks every layer in Tiled's order and decides by type + properties.
 *
 * - Tile layer -> `createLayer`; every tile with `collides: true` collides.
 * - Object layer -> one static sprite per tile object; it blocks the way if
 *   the object (or its layer) has `collides: true`. Depth = bottom edge, so
 *   that avatars pass in front of it or behind it.
 * - Object of class `zone` -> label with the name of the zone.
 * - Object of class `spawn` -> spawn point (the camera uses it at the start).
 * - Object of class `door` -> door to another world: it is marked on the floor
 *   and the scene uses it to travel when someone steps on it.
 * - Object of class `seat` -> a place to sit. Nothing is drawn for it: the
 *   chair is already furniture, and the hint appears when you stand on it.
 */
export function buildOfficeMap(scene: Phaser.Scene, worldId: string): BuiltMap {
  const key = mapKey(worldId)
  const raw = scene.cache.tilemap.get(key).data as TiledMap
  const tilemap = scene.make.tilemap({ key })

  const tilesets: Phaser.Tilemaps.Tileset[] = []
  for (const ts of raw.tilesets) {
    const tileset = tilemap.addTilesetImage(
      ts.name,
      ts.name,
      ts.tilewidth,
      ts.tileheight,
      ts.margin ?? 0,
      ts.spacing ?? 0,
    )
    if (tileset) tilesets.push(tileset)
    else console.warn(`[map] could not register the tileset "${ts.name}"`)
  }

  const collisionLayers: Phaser.Tilemaps.TilemapLayer[] = []
  const solids = scene.physics.add.staticGroup()
  let tileLayerIndex = 0
  let depth = TILE_LAYER_DEPTH_BASE

  for (const layer of flattenLayers(raw.layers)) {
    if (layer.visible === false) {
      if (layer.type === 'tilelayer') tileLayerIndex++
      continue
    }
    if (layer.type === 'tilelayer') {
      const created = tilemap.createLayer(tileLayerIndex++, tilesets, 0, 0)
      if (!created) continue
      created.setDepth(depth++)
      created.setCollisionByProperty({ [PROP_COLLIDES]: true })
      if (hasCollidingTiles(created)) collisionLayers.push(created)
    } else if (layer.type === 'objectgroup') {
      addObjects(scene, raw, layer, solids)
    }
  }

  addReceptionLogo(scene, raw)
  const doors = findDoors(raw)
  for (const door of doors) addDoorMarker(scene, door)
  addAmbient(scene, raw)

  const spawns = findSpawnPoints(raw)
  const entry = spawns.find((s) => s.name === DEFAULT_SPAWN_NAME)
  return {
    worldId,
    raw,
    tilemap,
    bounds: getMapBounds(raw),
    collisionLayers,
    solids,
    doors,
    seats: findSeats(raw),
    spawns,
    spawn: entry ? { x: entry.x, y: entry.y } : undefined,
  }
}

/**
 * Marks a door on the floor: a faint rectangle with the name of the world it
 * leads to, so it is visible that this is a way through to somewhere else. It
 * has no physics body: crossing it is walking over it.
 */
function addDoorMarker(scene: Phaser.Scene, door: Door) {
  const graphics = scene.add.graphics().setDepth(DOOR_DEPTH)
  graphics.fillStyle(DOOR_COLOR, 0.22)
  graphics.fillRect(door.x, door.y, door.width, door.height)
  graphics.lineStyle(2, DOOR_COLOR, 0.9)
  graphics.strokeRect(door.x + 1, door.y + 1, door.width - 2, door.height - 2)

  scene.add
    .text(door.x + door.width / 2, door.y - 4, worldName(door.world), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '8px',
      fontStyle: 'bold',
      color: '#ede9fe',
      backgroundColor: '#4c1d95cc',
      padding: { x: 3, y: 2 },
    })
    .setOrigin(0.5, 1)
    .setResolution(4)
    .setDepth(OVERLAY_DEPTH)
}

/**
 * Ambient colour of the world (the map's `ambient` property): a veil of the
 * colour and opacity the map states, over everything that is drawn. It is what
 * makes a world feel dark without needing new tiles.
 */
function addAmbient(scene: Phaser.Scene, raw: TiledMap) {
  const ambient = getAmbient(raw)
  if (!ambient) return
  const { color, alpha } = parseTiledColor(ambient)
  if (alpha <= 0) return
  const { width, height } = getMapBounds(raw)
  scene.add.rectangle(0, 0, width, height, color, alpha).setOrigin(0, 0).setDepth(AMBIENT_DEPTH)
}

/** Tiled colour (`#AARRGGBB` or `#RRGGBB`) to Phaser colour + opacity. */
export function parseTiledColor(value: string): { color: number; alpha: number } {
  const hex = value.replace('#', '')
  if (hex.length === 8) {
    return { color: parseInt(hex.slice(2), 16), alpha: parseInt(hex.slice(0, 2), 16) / 255 }
  }
  return { color: parseInt(hex, 16), alpha: 1 }
}

function hasCollidingTiles(layer: Phaser.Tilemaps.TilemapLayer): boolean {
  return layer.layer.data.some((row) => row.some((tile) => tile.collides))
}

function addObjects(
  scene: Phaser.Scene,
  raw: TiledMap,
  layer: TiledObjectLayer,
  solids: Phaser.Physics.Arcade.StaticGroup,
) {
  for (const obj of layer.objects) {
    if (obj.visible === false) continue
    const cls = objectClass(obj)
    if (cls === CLASS_ZONE) {
      addZoneLabel(scene, obj)
    } else if (cls === CLASS_SPAWN || cls === CLASS_DOOR || cls === CLASS_SEAT) {
      // Spawns, doors and seats are not drawn here: they are data, not furniture.
      continue
    } else if (obj.gid) {
      addTileObject(scene, raw, layer, obj, solids)
    }
  }
}

function addTileObject(
  scene: Phaser.Scene,
  raw: TiledMap,
  layer: TiledObjectLayer,
  obj: TiledObject,
  solids: Phaser.Physics.Arcade.StaticGroup,
) {
  const gid = obj.gid! & GID_MASK
  const tileset = tilesetForGid(raw, gid)
  if (!tileset || !scene.textures.exists(tileset.name)) {
    console.warn(`[map] object ${obj.id} uses an unknown tileset (gid ${gid})`)
    return
  }
  const width = obj.width ?? tileset.tilewidth
  const height = obj.height ?? tileset.tileheight
  // In Tiled the position of a tile object is its bottom-left corner.
  const x = obj.x + width / 2
  const y = obj.y - height / 2
  const frame = gid - tileset.firstgid

  const collides = objectCollides(layer, obj)
  const sprite = collides
    ? (solids.create(x, y, tileset.name, frame) as Phaser.Physics.Arcade.Sprite)
    : scene.add.sprite(x, y, tileset.name, frame)

  sprite.setFlip((obj.gid! & FLIP_H) !== 0, (obj.gid! & FLIP_V) !== 0)
  if (width !== sprite.width || height !== sprite.height) {
    sprite.setDisplaySize(width, height)
    if (collides) (sprite as Phaser.Physics.Arcade.Sprite).refreshBody()
  }
  sprite.setDepth(obj.y)
}

/**
 * Places the Taller logo as decoration for the reception: a sprite without a
 * physics body (it neither blocks the way nor touches the interactions)
 * anchored to the map's `Reception` zone. If the logo did not load or there is
 * no reception, it draws nothing (the office keeps working the same). The
 * depth uses its bottom edge, like the furniture, so avatars pass in front.
 */
function addReceptionLogo(scene: Phaser.Scene, raw: TiledMap) {
  if (!scene.textures.exists(LOGO_KEY)) return
  const zone = getZones(raw).find((z) => z.name === LOGO_ZONE)
  if (!zone) return
  const { height } = scene.textures.get(LOGO_KEY).getSourceImage()
  const x = Math.round(zone.x + zone.width * LOGO_ZONE_FRAC_X)
  const y = Math.round(zone.y + LOGO_ZONE_OFFSET_Y + height / 2)
  scene.add.image(x, y, LOGO_KEY).setDepth(LOGO_DEPTH)
}

function addZoneLabel(scene: Phaser.Scene, obj: TiledObject) {
  if (!obj.name || !(obj.width && obj.height)) return
  scene.add
    .text(obj.x + 4, obj.y + 3, obj.name, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '8px',
      fontStyle: 'bold',
      color: '#ffffff',
      backgroundColor: '#1b1f2acc',
      padding: { x: 3, y: 2 },
    })
    .setResolution(4)
    .setDepth(OVERLAY_DEPTH)
    .setAlpha(0.9)
}

/** Zone (if any) that contains the point. */
export function zoneAt(raw: TiledMap, x: number, y: number): string | undefined {
  return getZones(raw).find((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height)
    ?.name
}

/**
 * `?debug` mode: collision bodies of the tile layers (yellow), spawn points
 * (green), door areas (purple, with their destination) and seats (teal, with
 * their name). A seat with a collision body drawn over it is a seat nobody
 * can reach: this view is how you see that.
 */
export function drawCollisionDebug(scene: Phaser.Scene, built: BuiltMap) {
  const graphics = scene.add
    .graphics()
    .setAlpha(0.6)
    .setDepth(OVERLAY_DEPTH - 1)
  for (const layer of built.collisionLayers) {
    layer.renderDebug(graphics, {
      tileColor: null,
      collidingTileColor: new Phaser.Display.Color(243, 234, 48, 255),
      faceColor: new Phaser.Display.Color(40, 39, 37, 255),
    })
  }
  for (const spawn of built.spawns) {
    graphics.fillStyle(0x3ddc84, 1)
    graphics.fillCircle(spawn.x, spawn.y, 5)
    graphics.lineStyle(1, 0x3ddc84, 0.8)
    graphics.strokeCircle(spawn.x, spawn.y, spawn.radius)
  }
  for (const seat of built.seats) {
    graphics.fillStyle(SEAT_COLOR, 0.35)
    graphics.fillRect(seat.x, seat.y, seat.width, seat.height)
    graphics.lineStyle(1, SEAT_COLOR, 1)
    graphics.strokeRect(seat.x, seat.y, seat.width, seat.height)
    scene.add
      .text(seat.x + 2, seat.y - 2, `${seat.name} (${seat.dir})`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '7px',
        color: '#ecfdf5',
        backgroundColor: '#065f46cc',
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0, 1)
      .setResolution(4)
      .setDepth(OVERLAY_DEPTH)
  }
  for (const door of built.doors) {
    graphics.fillStyle(DOOR_COLOR, 0.45)
    graphics.fillRect(door.x, door.y, door.width, door.height)
    graphics.lineStyle(2, DOOR_COLOR, 1)
    graphics.strokeRect(door.x, door.y, door.width, door.height)
    scene.add
      .text(door.x + 2, door.y + door.height + 2, `→ ${door.world} / ${door.spawn}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '8px',
        color: '#ede9fe',
        backgroundColor: '#4c1d95cc',
        padding: { x: 3, y: 2 },
      })
      .setResolution(4)
      .setDepth(OVERLAY_DEPTH)
  }
}
