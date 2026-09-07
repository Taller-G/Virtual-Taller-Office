import Phaser from 'phaser'
import {
  CLASS_SPAWN,
  CLASS_ZONE,
  findSpawnPoints,
  flattenLayers,
  getMapBounds,
  getZones,
  objectClass,
  objectCollides,
  PROP_COLLIDES,
  tilesetForGid,
  type TiledMap,
  type TiledObject,
  type TiledObjectLayer,
} from '@vto/shared'
import { MAP_KEY } from './BootScene'

/** Bits de volteo que Tiled guarda en el gid de un objeto. */
const FLIP_H = 0x80000000
const FLIP_V = 0x40000000
const GID_MASK = 0x1fffffff

/** Profundidad de las capas de tiles: siempre debajo de muebles y avatares. */
const TILE_LAYER_DEPTH_BASE = -1000
/** Las etiquetas de zona van por encima de todo lo que camina por el mapa. */
export const OVERLAY_DEPTH = 100_000

export interface BuiltMap {
  raw: TiledMap
  tilemap: Phaser.Tilemaps.Tilemap
  bounds: { width: number; height: number }
  /** Capas de tiles con al menos un tile que colisiona. */
  collisionLayers: Phaser.Tilemaps.TilemapLayer[]
  /** Muebles que bloquean el paso. */
  solids: Phaser.Physics.Arcade.StaticGroup
  spawn?: { x: number; y: number }
}

/**
 * Construye la oficina a partir del mapa Tiled, sin depender de nombres de
 * capas: recorre todas en el orden de Tiled y decide por tipo + propiedades.
 *
 * - Capa de tiles → `createLayer`; colisiona todo tile con `collides: true`.
 * - Capa de objetos → un sprite estático por objeto-tile; bloquea el paso si
 *   el objeto (o su capa) tiene `collides: true`. Profundidad = borde
 *   inferior, para que los avatares pasen por delante o por detrás.
 * - Objeto de clase `zone` → etiqueta con el nombre de la zona.
 * - Objeto de clase `spawn` → punto de aparición (lo usa la cámara al inicio).
 */
export function buildOfficeMap(scene: Phaser.Scene): BuiltMap {
  const raw = scene.cache.tilemap.get(MAP_KEY).data as TiledMap
  const tilemap = scene.make.tilemap({ key: MAP_KEY })

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
    else console.warn(`[mapa] no se pudo registrar el tileset "${ts.name}"`)
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

  const spawn = findSpawnPoints(raw)[0]
  return {
    raw,
    tilemap,
    bounds: getMapBounds(raw),
    collisionLayers,
    solids,
    spawn: spawn ? { x: spawn.x, y: spawn.y } : undefined,
  }
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
    } else if (cls === CLASS_SPAWN) {
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
    console.warn(`[mapa] objeto ${obj.id} usa un tileset desconocido (gid ${gid})`)
    return
  }
  const width = obj.width ?? tileset.tilewidth
  const height = obj.height ?? tileset.tileheight
  // En Tiled la posición de un objeto-tile es su esquina inferior izquierda.
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

/** Zona (si la hay) que contiene el punto. */
export function zoneAt(raw: TiledMap, x: number, y: number): string | undefined {
  return getZones(raw).find((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height)
    ?.name
}

/** Dibuja los cuerpos de colisión de las capas de tiles (modo `?debug`). */
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
  if (built.spawn) {
    graphics.fillStyle(0x3ddc84, 1)
    graphics.fillCircle(built.spawn.x, built.spawn.y, 5)
  }
}
