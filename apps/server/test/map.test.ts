import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASS_ZONE,
  doorAt,
  findDoors,
  findSpawnPoint,
  findSpawnPoints,
  getZones,
  isSolidAt,
  objectCollides,
  objectLayers,
  PROP_COLLIDES,
  tileLayers,
  tilesetForGid,
  validateMap,
  WORLDS,
  type TiledMap,
  type Zone,
} from '@vto/shared'
import { DEFAULT_MAP_FILE, loadOfficeMap, loadWorldMaps } from '../src/map'

/**
 * These tests run against the REAL map that gets deployed. If someone edits
 * it in Tiled and breaks the contract (missing spawn, tileset not embedded,
 * image that does not exist), they fail here before reaching production.
 */
describe('Office map (real file)', () => {
  const office = loadOfficeMap(DEFAULT_MAP_FILE)
  const map = office.data

  it('meets the minimum contract', () => {
    expect(validateMap(map)).toEqual([])
    expect(map.tilewidth).toBe(32)
    expect(map.tileheight).toBe(32)
  })

  it('has a spawn point on walkable floor', () => {
    const spawn = findSpawnPoint(map)
    expect(spawn.x).toBeGreaterThan(0)
    expect(spawn.y).toBeGreaterThan(0)
    expect(spawn.x).toBeLessThan(office.bounds.width)
    expect(spawn.y).toBeLessThan(office.bounds.height)
    expect(isSolidAt(map, spawn.x, spawn.y)).toBe(false)
    expect(spawn.radius).toBeGreaterThan(0)
  })

  it('the images of every tileset exist next to the map', () => {
    for (const ts of map.tilesets) {
      const image = resolve(dirname(office.file), ts.image)
      expect(existsSync(image), `missing ${ts.image} (tileset ${ts.name})`).toBe(true)
    }
  })

  it('has separate layers for floor, walls, furniture and colliding objects', () => {
    const tiles = tileLayers(map)
    expect(tiles.length).toBeGreaterThanOrEqual(2)
    // At least one tile layer without collisions (floor) and one with them (walls).
    const withSolid = tiles.filter((layer) =>
      layer.data.some(
        (gid, i) =>
          isSolidAt(
            map,
            (i % layer.width) * map.tilewidth,
            Math.floor(i / layer.width) * map.tileheight,
          ) && gid !== 0,
      ),
    )
    expect(withSolid.length).toBeGreaterThanOrEqual(1)
    expect(withSolid.length).toBeLessThan(tiles.length)

    const objects = objectLayers(map).filter((l) => l.objects.some((o) => o.gid))
    const solid = objects.filter((l) => l.objects.some((o) => objectCollides(l, o)))
    const decor = objects.filter((l) => l.objects.some((o) => !objectCollides(l, o)))
    expect(solid.length).toBeGreaterThanOrEqual(1)
    expect(decor.length).toBeGreaterThanOrEqual(1)
  })

  it('defines the four minimum zones of the office', () => {
    const names = getZones(map).map((z) => z.name.toLowerCase())
    expect(names.some((n) => n.includes('reception'))).toBe(true)
    expect(names.some((n) => n.includes('desks'))).toBe(true)
    expect(names.some((n) => n.includes('meeting'))).toBe(true)
    expect(names.some((n) => n.includes('kitchen'))).toBe(true)
  })

  it('has the south wing rooms: two more meeting rooms and a focus room', () => {
    const names = getZones(map).map((z) => z.name)
    expect(
      names.filter((n) => n.toLowerCase().includes('meeting')).length,
    ).toBeGreaterThanOrEqual(3)
    expect(names).toContain('Focus Room')
  })

  it('no room is a trap: every zone is reachable on foot', () => {
    const spawn = findSpawnPoint(map)
    const reachable = reachableTiles(map, {
      col: Math.floor(spawn.x / map.tilewidth),
      row: Math.floor(spawn.y / map.tileheight),
    })
    for (const zone of getZones(map)) {
      expect(
        tilesOf(map, zone).some(({ col, row }) => reachable.has(`${col},${row}`)),
        `the zone "${zone.name}" cannot be reached on foot`,
      ).toBe(true)
    }
  })

  it('the collision of the objects lives in the map, not in code', () => {
    // No furniture object layer depends on its name: only on `collides`.
    const layers = objectLayers(map).filter((l) => l.objects.some((o) => o.gid))
    for (const layer of layers) {
      const declared = layer.properties?.some((p) => p.name === PROP_COLLIDES)
      const perObject = layer.objects.every((o) =>
        o.properties?.some((p) => p.name === PROP_COLLIDES),
      )
      expect(declared || perObject, `the layer "${layer.name}" does not declare collides`).toBe(true)
    }
    expect(objectLayers(map).some((l) => l.objects.some((o) => o.type === CLASS_ZONE))).toBe(true)
  })
})

describe('loadOfficeMap: invalid maps fail with a clear message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vto-map-'))

  function write(name: string, content: unknown) {
    const file = join(dir, name)
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
    return file
  }

  const minimal: TiledMap = {
    orientation: 'orthogonal',
    width: 2,
    height: 2,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        name: 't',
        firstgid: 1,
        image: 't.png',
        imagewidth: 64,
        imageheight: 32,
        tilewidth: 32,
        tileheight: 32,
        tilecount: 2,
        columns: 2,
        tiles: [{ id: 1, properties: [{ name: PROP_COLLIDES, type: 'bool', value: true }] }],
      },
    ],
    layers: [
      { type: 'tilelayer', id: 1, name: 'Floor', width: 2, height: 2, data: [1, 1, 2, 1] },
      {
        type: 'objectgroup',
        id: 2,
        name: 'Spawn',
        objects: [{ id: 1, type: 'spawn', point: true, x: 16, y: 16 }],
      },
    ],
  }

  it('accepts a minimal valid map', () => {
    const office = loadOfficeMap(write('ok.json', minimal))
    expect(office.spawn).toEqual({ name: 'default', x: 16, y: 16, radius: 32, dir: 'down' })
    expect(office.bounds).toEqual({ width: 64, height: 64 })
  })

  it('file that does not exist', () => {
    expect(() => loadOfficeMap(join(dir, 'nope.json'))).toThrow(/Could not read the map/)
  })

  it('broken JSON', () => {
    expect(() => loadOfficeMap(write('bad.json', '{ not json'))).toThrow(/is not valid JSON/)
  })

  it('no spawn', () => {
    const noSpawn = { ...minimal, layers: [minimal.layers[0]] }
    expect(() => loadOfficeMap(write('nospawn.json', noSpawn))).toThrow(/exactly one object/)
  })

  it('spawn on a wall', () => {
    const onWall = {
      ...minimal,
      layers: [
        minimal.layers[0],
        {
          type: 'objectgroup',
          id: 2,
          name: 'Spawn',
          objects: [{ id: 1, type: 'spawn', point: true, x: 16, y: 48 }],
        },
      ],
    }
    expect(() => loadOfficeMap(write('wall.json', onWall))).toThrow(/colliding tile/)
  })

  it('external tileset (not embedded)', () => {
    const external = {
      ...minimal,
      tilesets: [{ firstgid: 1, source: 't.tsx' }],
    }
    expect(() => loadOfficeMap(write('ext.json', external))).toThrow(/is not embedded/)
  })
})

/**
 * The real maps of every world, loaded the way the server loads them at boot:
 * each one valid on its own and the doors matching up between them.
 */
describe('Worlds (real files)', () => {
  const worlds = loadWorldMaps()

  it('loads one map for each world in the registry', () => {
    expect([...worlds.keys()]).toEqual(WORLDS.map((w) => w.id))
    for (const [id, world] of worlds) {
      expect(validateMap(world.data), `map of ${id}`).toEqual([])
    }
  })

  it('the First Office and the Chiron Office are connected both ways', () => {
    const first = worlds.get('first-office')!.data
    const chiron = worlds.get('chiron-office')!.data

    const toChiron = findDoors(first)
    expect(toChiron).toHaveLength(1)
    expect(toChiron[0]).toMatchObject({ world: 'chiron-office', spawn: 'from-first-office' })

    const toFirst = findDoors(chiron)
    expect(toFirst).toHaveLength(1)
    expect(toFirst[0]).toMatchObject({ world: 'first-office', spawn: 'from-chiron' })

    // Each door arrives at a spawn that exists and that is not on top of the
    // return door: otherwise you would go straight back to the previous world.
    const arrival = findSpawnPoint(chiron, 'from-first-office')
    expect(doorAt(chiron, arrival.x, arrival.y)).toBeUndefined()
    const back = findSpawnPoint(first, 'from-chiron')
    expect(doorAt(first, back.x, back.y)).toBeUndefined()
    expect(back.dir).toBe('down')
    expect(arrival.dir).toBe('up')
  })

  it('no spawn or door falls on a wall or a solid piece of furniture', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const furniture = tilesBlockedByFurniture(map)
      const free = (x: number, y: number) =>
        !furniture.has(tileKey(map, x, y)) && !isSolidAt(map, x, y)

      for (const spawn of findSpawnPoints(map)) {
        expect(free(spawn.x, spawn.y), `${id}: spawn "${spawn.name}"`).toBe(true)
      }
      for (const door of findDoors(map)) {
        const x = door.x + door.width / 2
        const y = door.y + door.height / 2
        expect(free(x, y), `${id}: door "${door.name}"`).toBe(true)
      }
    }
  })

  it('every world\'s door is reachable on foot from its entrance', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const entry = world.spawn
      const reachable = reachableTiles(map, {
        col: Math.floor(entry.x / map.tilewidth),
        row: Math.floor(entry.y / map.tileheight),
      })
      for (const door of findDoors(map)) {
        const key = tileKey(map, door.x + door.width / 2, door.y + door.height / 2)
        expect(
          reachable.has(key),
          `${id}: the door "${door.name}" cannot be reached on foot`,
        ).toBe(true)
      }
    }
  })
})

/** Key of the cell that contains the point. */
function tileKey(map: TiledMap, x: number, y: number): string {
  return `${Math.floor(x / map.tilewidth)},${Math.floor(y / map.tileheight)}`
}

/** Tiles a zone occupies. */
function tilesOf(map: TiledMap, zone: Zone) {
  const out: { col: number; row: number }[] = []
  for (
    let row = Math.floor(zone.y / map.tileheight);
    row * map.tileheight < zone.y + zone.height;
    row++
  )
    for (
      let col = Math.floor(zone.x / map.tilewidth);
      col * map.tilewidth < zone.x + zone.width;
      col++
    )
      out.push({ col, row })
  return out
}

/** Tiles blocked by a colliding piece of furniture (tiles are covered by `isSolidAt`). */
function tilesBlockedByFurniture(map: TiledMap): Set<string> {
  const blocked = new Set<string>()
  for (const layer of objectLayers(map)) {
    for (const obj of layer.objects) {
      if (!obj.gid || !objectCollides(layer, obj)) continue
      const tileset = tilesetForGid(map, obj.gid)
      const width = obj.width ?? tileset?.tilewidth ?? map.tilewidth
      const height = obj.height ?? tileset?.tileheight ?? map.tileheight
      // In Tiled the `y` of a tile object is its bottom edge.
      for (
        let row = Math.floor((obj.y - height) / map.tileheight);
        row * map.tileheight < obj.y;
        row++
      )
        for (
          let col = Math.floor(obj.x / map.tilewidth);
          col * map.tilewidth < obj.x + width;
          col++
        )
          blocked.add(`${col},${row}`)
    }
  }
  return blocked
}

/**
 * Tiles reachable on foot from `start`, with the same notion of "blocked"
 * the game uses: tiles with `collides` and colliding furniture.
 */
function reachableTiles(map: TiledMap, start: { col: number; row: number }): Set<string> {
  const furniture = tilesBlockedByFurniture(map)
  const blocked = (col: number, row: number) =>
    col < 0 ||
    row < 0 ||
    col >= map.width ||
    row >= map.height ||
    furniture.has(`${col},${row}`) ||
    isSolidAt(
      map,
      col * map.tilewidth + map.tilewidth / 2,
      row * map.tileheight + map.tileheight / 2,
    )

  const seen = new Set<string>([`${start.col},${start.row}`])
  const pending = [start]
  while (pending.length > 0) {
    const { col, row } = pending.pop()!
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { col: col + dc, row: row + dr }
      const key = `${next.col},${next.row}`
      if (seen.has(key) || blocked(next.col, next.row)) continue
      seen.add(key)
      pending.push(next)
    }
  }
  return seen
}
