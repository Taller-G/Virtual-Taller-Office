import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_FRAME,
  CLASS_ZONE,
  doorAt,
  findDoors,
  findSeats,
  findSpawnPoint,
  findSpawnPoints,
  getZones,
  isSolidAt,
  objectClass,
  objectCollides,
  objectLayers,
  PROP_COLLIDES,
  seatAnchor,
  seatAtRect,
  tileCollides,
  tileLayers,
  tilesetForGid,
  validateMap,
  WORLDS,
  type SpawnPoint,
  type TiledMap,
  type TiledObject,
  type Zone,
} from '@vto/shared'
import { DEFAULT_MAP_FILE, loadOfficeMap, loadWorldMaps } from '../src/map'

/** The Chiron Office's own tileset (see `tools/make-chiron-tileset.py`). */
const DARK_TILESET = 'ChironDark'
/** Zone you land in coming through the door from the First Office. */
const ARRIVAL_ZONE = 'Arrival Hall'
/** How many focus desks the Chiron Office is meant to have. */
const FOCUS_DESKS = 6

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
    expect(names.filter((n) => n.toLowerCase().includes('meeting')).length).toBeGreaterThanOrEqual(
      3,
    )
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
      expect(declared || perObject, `the layer "${layer.name}" does not declare collides`).toBe(
        true,
      )
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
    // And you land with your back to the opening you came through, not facing
    // it: otherwise the first step forward is going straight back.
    expect(facingAwayFromDoor(chiron, arrival), 'arrival in Chiron').toBe(true)
    expect(facingAwayFromDoor(first, back), 'back in the First Office').toBe(true)
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

  it('no world can be walked out of: the walls close it', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const reachable = reachableTiles(map, {
        col: Math.floor(world.spawn.x / map.tilewidth),
        row: Math.floor(world.spawn.y / map.tileheight),
      })
      // `reachableTiles` already treats the outside of the map as blocked, so
      // the symptom of a hole in the wall is walking as far as its border.
      for (const key of reachable) {
        const [col, row] = key.split(',').map(Number)
        expect(
          col > 0 && row > 0 && col < map.width - 1 && row < map.height - 1,
          `${id}: you can walk to the map border at (${col},${row}): missing wall`,
        ).toBe(true)
      }
    }
  })

  it("every world's door is reachable on foot from its entrance", () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const entry = world.spawn
      const reachable = reachableTiles(map, {
        col: Math.floor(entry.x / map.tilewidth),
        row: Math.floor(entry.y / map.tileheight),
      })
      for (const door of findDoors(map)) {
        const key = tileKey(map, door.x + door.width / 2, door.y + door.height / 2)
        expect(reachable.has(key), `${id}: the door "${door.name}" cannot be reached on foot`).toBe(
          true,
        )
      }
    }
  })
})

/**
 * The Chiron Office map: the second world, dark and open-plan. What is checked
 * here is what makes it habitable (every zone reachable on foot, the arrival
 * landing in the lobby) and what makes it *another place*: that it is painted
 * with its own dark tileset.
 */
describe('Chiron Office (real file)', () => {
  const chiron = loadWorldMaps().get('chiron-office')!
  const map = chiron.data

  it('has an arrival hall and several more zones, all named', () => {
    const zones = getZones(map)
    const names = zones.map((z) => z.name)
    expect(names).toContain(ARRIVAL_ZONE)
    expect(names).toContain('Focus Desks')
    expect(names.length).toBeGreaterThanOrEqual(3)
    for (const zone of zones) expect(zone.name.trim(), 'unnamed zone').not.toBe('')
    // No repeats: two identical labels on the map cannot be told apart.
    expect(new Set(names).size).toBe(names.length)
  })

  it('every one of its zones is reachable on foot from the entrance', () => {
    const reachable = reachableTiles(map, {
      col: Math.floor(chiron.spawn.x / map.tilewidth),
      row: Math.floor(chiron.spawn.y / map.tileheight),
    })
    for (const zone of getZones(map)) {
      expect(
        tilesOf(map, zone).some(({ col, row }) => reachable.has(`${col},${row}`)),
        `the zone "${zone.name}" cannot be reached on foot`,
      ).toBe(true)
    }
  })

  it('arriving from the First Office lands in the arrival hall, not just anywhere', () => {
    const arrival = findSpawnPoint(map, 'from-first-office')
    expect(zoneNameAt(map, arrival.x, arrival.y)).toBe(ARRIVAL_ZONE)
  })

  /**
   * Arriving has to tell you where you are and how to get out again without
   * moving: the Chiron mark (the world's name in light on the wall) and the
   * way back are both a few tiles from where you land.
   */
  it('lands you within sight of the return door', () => {
    const arrival = findSpawnPoint(map, 'from-first-office')
    const [door] = findDoors(map)
    const tiles = Math.hypot(door.x - arrival.x, door.y - arrival.y) / map.tilewidth
    expect(tiles).toBeLessThanOrEqual(4)
  })

  it('is painted with its own dark tileset, not the First Office one', () => {
    const dark = map.tilesets.find((ts) => ts.name === DARK_TILESET)
    expect(dark, `missing the ${DARK_TILESET} tileset`).toBeDefined()
    expect(existsSync(resolve(dirname(chiron.file), dark!.image))).toBe(true)

    // Every drawn tile comes from there: one from the bright pack would show
    // up as a lit patch in the middle of the office.
    const foreign = new Set<string>()
    for (const layer of tileLayers(map)) {
      for (const gid of layer.data) {
        if (!gid) continue
        const ts = tilesetForGid(map, gid)
        if (ts && ts.name !== DARK_TILESET) foreign.add(ts.name)
      }
    }
    expect([...foreign]).toEqual([])
  })

  /**
   * The focus desks. A seat is what someone sits at to be "focused", so the
   * ones that matter here are the properties that make that possible at all:
   * you can walk onto it, you can be told apart from the next one, and the
   * desk it belongs to does not wall it in.
   */
  describe('the focus desks', () => {
    const seats = findSeats(map)

    it(`has ${FOCUS_DESKS} seats, each with its own name`, () => {
      expect(seats).toHaveLength(FOCUS_DESKS)
      const names = seats.map((s) => s.name)
      for (const name of names) expect(name.trim(), 'unnamed seat').not.toBe('')
      expect(new Set(names).size, 'two seats share a name').toBe(names.length)
    })

    it('every seat is in the Focus Desks zone and faces its desk', () => {
      for (const seat of seats) {
        const { x, y } = seatAnchor(seat)
        expect(zoneNameAt(map, x, y), `seat "${seat.name}"`).toBe('Focus Desks')
        // The chairs are drawn above their desks, so sitting is facing south.
        expect(seat.dir, `seat "${seat.name}"`).toBe('down')
      }
    })

    /**
     * Nothing may block a seat: not a wall tile, not the desk it belongs to.
     * This is the check behind "the debug collision view shows no collision
     * body on any seat tile".
     */
    it('no seat has anything solid on it, and all of them are reachable on foot', () => {
      const furniture = tilesBlockedByFurniture(map)
      const reachable = reachableTiles(map, {
        col: Math.floor(chiron.spawn.x / map.tilewidth),
        row: Math.floor(chiron.spawn.y / map.tileheight),
      })
      for (const seat of seats) {
        const { x, y } = seatAnchor(seat)
        expect(isSolidAt(map, x, y), `seat "${seat.name}" is on a colliding tile`).toBe(false)
        expect(
          furniture.has(tileKey(map, x, y)),
          `seat "${seat.name}" is under a solid piece of furniture`,
        ).toBe(false)
        expect(
          reachable.has(tileKey(map, x, y)),
          `seat "${seat.name}" cannot be reached on foot`,
        ).toBe(true)
      }
    })

    /** Sitting down must never be a way to stand in a doorway. */
    it('no seat overlaps a door', () => {
      for (const seat of seats) {
        const { x, y } = seatAnchor(seat)
        expect(doorAt(map, x, y), `seat "${seat.name}"`).toBeUndefined()
      }
    })

    /**
     * A seat is found from where the body is, so two of them may not overlap:
     * standing between them would make "which seat is this?" a coin toss.
     * `seatAtRect` with a seat's own rectangle has to answer that same seat.
     */
    it('no two seats overlap', () => {
      for (const seat of seats) {
        expect(seatAtRect(map, seat)?.name, `seat "${seat.name}"`).toBe(seat.name)
      }
    })
  })

  /**
   * The furniture. These do not check that the office is pretty — they check
   * the two ways it has actually been broken: a block of gids that draws part
   * of an object (a worktop with no cupboard under it, half an armchair, a
   * cabinet with an empty column), and a collision that does not agree with
   * what is drawn. The first kind is caught at the source by
   * `tools/tileset_pieces.py` when the map is generated; what is left for here
   * is everything that can be seen in the map file itself.
   */
  describe('the furniture', () => {
    const solids = tilesBlockedByFurniture(map)
    const drawn = tilesDrawnOnByFurniture(map)

    it('every piece uses tiles that exist in an embedded tileset', () => {
      for (const layer of objectLayers(map)) {
        for (const obj of layer.objects) {
          if (!obj.gid) continue
          const tileset = tilesetForGid(map, obj.gid)
          expect(
            tileset,
            `object ${obj.id} uses gid ${obj.gid}, which no tileset covers`,
          ).toBeDefined()
          const id = (obj.gid & 0x1fffffff) - tileset!.firstgid
          expect(
            id < tileset!.tilecount,
            `object ${obj.id} asks "${tileset!.name}" for tile ${id} of ${tileset!.tilecount}`,
          ).toBe(true)
        }
      }
    })

    /** A piece off the grid is a piece drawn a few pixels into its neighbour. */
    it('every piece sits on the tile grid', () => {
      for (const layer of objectLayers(map)) {
        for (const obj of layer.objects) {
          if (!obj.gid) continue
          expect(obj.x % map.tilewidth, `object ${obj.id} is off the grid`).toBe(0)
          expect(obj.y % map.tileheight, `object ${obj.id} is off the grid`).toBe(0)
        }
      }
    })

    /**
     * Everything that blocks the way is a piece of furniture you can see.
     *
     * The client draws a colliding object with the very same sprite as a
     * decorative one (`addTileObject`), so in this map a body and its drawing
     * are one thing — as long as the object really is a tile object that is
     * really drawn. The two ways to break that, both of them ordinary things
     * to do in Tiled, are a bare rectangle dropped in the colliding layer and
     * an object switched to invisible: the client then draws nothing and walks
     * through, while the server (and everything here that walks the map) still
     * treats the tile as blocked. The two halves of the office would disagree
     * about where the walls are, and only one of them is on screen.
     *
     * Whether the sprite's own tile has any ink on it is a question about the
     * PNG rather than the map, and it is settled where the map is built:
     * `tools/make-chiron-map.py` only lets a tile block the way once enough of
     * it is drawn on (`Piece.ink`).
     */
    it('everything that blocks the way is drawn', () => {
      for (const layer of objectLayers(map)) {
        for (const obj of layer.objects) {
          if (!objectCollides(layer, obj)) continue
          if (objectClass(obj) !== '') continue // zones, seats, doors and spawns are not furniture
          expect(
            obj.gid,
            `object ${obj.id} in "${layer.name}" blocks the way but draws no tile`,
          ).toBeDefined()
          expect(
            obj.visible !== false,
            `object ${obj.id} in "${layer.name}" blocks the way but is hidden`,
          ).toBe(true)
        }
      }
      // And, the other way round, nothing is blocked that no object covers.
      for (const key of solids) {
        expect(
          drawn.has(key),
          `something blocks the way at (${key}) with nothing drawn on it`,
        ).toBe(true)
      }
    })

    /** A body over a wall is a body nobody could have walked into anyway. */
    it('no piece stands on a wall or in a doorway', () => {
      for (const key of solids) {
        const [col, row] = key.split(',').map(Number)
        const x = col * map.tilewidth + map.tilewidth / 2
        const y = row * map.tileheight + map.tileheight / 2
        expect(
          isSolidAt(map, x, y),
          `a piece of furniture is drawn over the wall at (${key})`,
        ).toBe(false)
        expect(
          doorAt(map, x, y),
          `a piece of furniture blocks the door at (${key})`,
        ).toBeUndefined()
      }
    })

    /**
     * No pocket: every tile the map paints a floor on has to be walkable to.
     * Furniture is what closes one — a run of cabinets across an alcove seals
     * the strip behind it, and nothing else in the suite would notice.
     * (Tiles with no floor under them are outside the office and are not
     * anybody's to reach.)
     */
    it('no piece of furniture closes off a piece of floor', () => {
      const reachable = reachableTiles(map, {
        col: Math.floor(chiron.spawn.x / map.tilewidth),
        row: Math.floor(chiron.spawn.y / map.tileheight),
      })
      for (const { col, row } of flooredTiles(map)) {
        const x = col * map.tilewidth + map.tilewidth / 2
        const y = row * map.tileheight + map.tileheight / 2
        if (isSolidAt(map, x, y) || solids.has(`${col},${row}`)) continue
        expect(
          reachable.has(`${col},${row}`),
          `the floor at (${col},${row}) cannot be reached on foot`,
        ).toBe(true)
      }
    })
  })

  /**
   * Getting to a desk and getting away from it again. Avatars do not collide
   * with each other (only with the tile layers and the solid furniture — see
   * `OfficeScene`), so "with the other five occupied" is the same walk as with
   * the office empty; what has to hold is that the route exists at all, from
   * both ways into the world, and that it does not go through anybody's chair.
   */
  describe('getting to the focus desks', () => {
    const seats = findSeats(map)

    it('every seat is reachable from the entrance and from the arrival door', () => {
      for (const from of ['default', 'from-first-office']) {
        const spawn = findSpawnPoint(map, from)
        const reachable = reachableTiles(map, {
          col: Math.floor(spawn.x / map.tilewidth),
          row: Math.floor(spawn.y / map.tileheight),
        })
        for (const seat of seats) {
          const { x, y } = seatAnchor(seat)
          expect(
            reachable.has(tileKey(map, x, y)),
            `seat "${seat.name}" cannot be reached from the "${from}" spawn`,
          ).toBe(true)
        }
        // And back out again: the way to the door is the same walk in reverse.
        for (const door of findDoors(map)) {
          const key = tileKey(map, door.x + door.width / 2, door.y + door.height / 2)
          expect(reachable.has(key), `the door cannot be reached from "${from}"`).toBe(true)
        }
      }
    })

    /**
     * Two people at neighbouring desks have to be two people, not one smudge:
     * an avatar is `AVATAR_FRAME.width` across, so seats closer than that
     * would overlap on screen even though the map lets both be sat in.
     */
    it('no two seats are close enough for their avatars to overlap', () => {
      for (const seat of seats) {
        for (const other of seats) {
          if (other === seat) continue
          const a = seatAnchor(seat)
          const b = seatAnchor(other)
          expect(
            Math.abs(a.x - b.x) >= AVATAR_FRAME.width || Math.abs(a.y - b.y) >= AVATAR_FRAME.width,
            `"${seat.name}" and "${other.name}" are drawn on top of each other`,
          ).toBe(true)
        }
      }
    })

    /**
     * Sitting down must not put you in the way. A seat whose tile is the only
     * way past is a seat that closes off part of the office every time
     * somebody uses it. (Avatars do not collide with each other, so this is
     * about the shape of the layout, not about being physically stuck: it is
     * the difference between a seat in an alcove and a seat in a doorway.)
     */
    it('no seat is the only way through: the office holds together without it', () => {
      const withoutSeats = reachableTiles(map, {
        col: Math.floor(chiron.spawn.x / map.tilewidth),
        row: Math.floor(chiron.spawn.y / map.tileheight),
      })
      for (const seat of seats) {
        const anchor = seatAnchor(seat)
        const blocked = new Set([tileKey(map, anchor.x, anchor.y)])
        const stillReachable = reachableTiles(
          map,
          {
            col: Math.floor(chiron.spawn.x / map.tilewidth),
            row: Math.floor(chiron.spawn.y / map.tileheight),
          },
          blocked,
        )
        for (const key of withoutSeats) {
          if (blocked.has(key)) continue
          expect(
            stillReachable.has(key),
            `somebody sitting at "${seat.name}" cuts (${key}) off from the rest of the office`,
          ).toBe(true)
        }
      }
    })
  })

  it('has its lights layer, and it does not block the way', () => {
    const layers = tileLayers(map)
    expect(layers.length).toBeGreaterThanOrEqual(3)
    // Lights are drawn over the floor; none of them may turn a tile you could
    // already walk on into a solid one.
    const lights = layers.find((l) => l.name === 'Lights')
    expect(lights, 'missing the "Lights" layer').toBeDefined()
    for (const [i, gid] of lights!.data.entries()) {
      if (!gid) continue
      const col = i % lights!.width
      const row = Math.floor(i / lights!.width)
      expect(tileCollides(map, gid), `the light at (${col},${row}) blocks the way`).toBe(false)
    }
  })
})

/**
 * Does the arrival point face away from the door it came through? It is
 * measured against the nearest door in the same map, which is the one that
 * matches it: `dir` has to point inwards, away from it.
 */
function facingAwayFromDoor(map: TiledMap, spawn: SpawnPoint): boolean {
  const doors = findDoors(map)
  expect(doors.length, 'the map has no doors').toBeGreaterThan(0)
  const nearest = doors
    .map((d) => ({ x: d.x + d.width / 2, y: d.y + d.height / 2 }))
    .reduce((best, c) =>
      Math.hypot(c.x - spawn.x, c.y - spawn.y) < Math.hypot(best.x - spawn.x, best.y - spawn.y)
        ? c
        : best,
    )
  const away = { x: spawn.x - nearest.x, y: spawn.y - nearest.y }
  const facing = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[spawn.dir]
  return facing.x * away.x + facing.y * away.y > 0
}

/** Name of the zone that contains the point, if any. */
function zoneNameAt(map: TiledMap, x: number, y: number): string | undefined {
  return getZones(map).find((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height)
    ?.name
}

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

/** Tiles a tile object covers. In Tiled the `y` of a tile object is its bottom edge. */
function tilesUnder(map: TiledMap, obj: TiledObject): string[] {
  const tileset = tilesetForGid(map, obj.gid!)
  const width = obj.width ?? tileset?.tilewidth ?? map.tilewidth
  const height = obj.height ?? tileset?.tileheight ?? map.tileheight
  const out: string[] = []
  for (let row = Math.floor((obj.y - height) / map.tileheight); row * map.tileheight < obj.y; row++)
    for (let col = Math.floor(obj.x / map.tilewidth); col * map.tilewidth < obj.x + width; col++)
      out.push(`${col},${row}`)
  return out
}

/** Tiles blocked by a colliding piece of furniture (tiles are covered by `isSolidAt`). */
function tilesBlockedByFurniture(map: TiledMap): Set<string> {
  const blocked = new Set<string>()
  for (const layer of objectLayers(map)) {
    for (const obj of layer.objects) {
      if (!obj.gid || !objectCollides(layer, obj)) continue
      for (const key of tilesUnder(map, obj)) blocked.add(key)
    }
  }
  return blocked
}

/** Tiles a piece of furniture is drawn on, whether or not it blocks the way. */
function tilesDrawnOnByFurniture(map: TiledMap): Set<string> {
  const drawn = new Set<string>()
  for (const layer of objectLayers(map)) {
    for (const obj of layer.objects) {
      if (!obj.gid) continue
      for (const key of tilesUnder(map, obj)) drawn.add(key)
    }
  }
  return drawn
}

/**
 * Tiles the map paints a floor on: the inside of the world. A map is a
 * rectangle and the room is not, so the strip outside the walls has no floor
 * under it and is nobody's to walk to.
 */
function flooredTiles(map: TiledMap): { col: number; row: number }[] {
  const floored = new Set<string>()
  for (const layer of tileLayers(map))
    for (const [i, gid] of layer.data.entries())
      if (gid && !tileCollides(map, gid))
        floored.add(`${i % layer.width},${Math.floor(i / layer.width)}`)
  return [...floored].map((key) => {
    const [col, row] = key.split(',').map(Number)
    return { col, row }
  })
}

/**
 * Tiles reachable on foot from `start`, with the same notion of "blocked"
 * the game uses: tiles with `collides` and colliding furniture.
 */
function reachableTiles(
  map: TiledMap,
  start: { col: number; row: number },
  /** Extra tiles to treat as blocked — somebody standing there, say. */
  occupied: ReadonlySet<string> = new Set(),
): Set<string> {
  const furniture = tilesBlockedByFurniture(map)
  const blocked = (col: number, row: number) =>
    col < 0 ||
    row < 0 ||
    col >= map.width ||
    row >= map.height ||
    furniture.has(`${col},${row}`) ||
    occupied.has(`${col},${row}`) ||
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
